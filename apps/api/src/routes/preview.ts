import type { FastifyPluginAsync } from 'fastify';
import {
  createPreviewArtifact,
  getPreviewArtifactById,
  listPreviewArtifactsBySession,
} from '../db/previewArtifactQueries.js';
import { ensureSessionExists } from '../db/sessionQueries.js';
import { createPreviewSignedUrl } from '../services/previewStorageService.js';
import { previewBuildWorker } from '../preview/previewBuildWorker.js';
import {
  detectWorkspaceForAbsolutePath,
  getWorkspaceById,
  listPreviewWorkspaces,
} from '../preview/workspaceRegistry.js';
import type {
  PreviewArtifactSummary,
  PreviewArtifactType,
  PreviewSourceFile,
  PreviewWorkspaceMount,
} from '../preview/types.js';

interface CreatePreviewArtifactBody {
  sessionId?: string;
  messageId?: string;
  sourceKind?: 'inline' | 'tool_event' | 'manual';
  type?: PreviewArtifactType;
  title?: string;
  language?: string;
  content?: string;
  entrypoint?: string;
  sourceFiles?: Array<string | { workspaceId?: string; path: string }>;
  workspaceMounts?: Array<string | { workspaceId?: string; path: string }>;
}

function uniqueMounts(mounts: PreviewWorkspaceMount[]): PreviewWorkspaceMount[] {
  const seen = new Set<string>();
  const out: PreviewWorkspaceMount[] = [];
  for (const mount of mounts) {
    const key = `${mount.workspaceId}:${mount.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mount);
  }
  return out;
}

function normalizeRelativePath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '');
  if (!trimmed) return '.';
  return trimmed.split('/').filter(Boolean).join('/');
}

async function normalizePathRef(
  input: string | { workspaceId?: string; path: string },
): Promise<{ workspaceId: string; path: string } | null> {
  const rawPath = typeof input === 'string' ? input : input.path;
  const rawWorkspaceId = typeof input === 'string' ? '' : (input.workspaceId || '').trim();
  if (!rawPath || !rawPath.trim()) return null;

  if (rawWorkspaceId) {
    const ws = getWorkspaceById(rawWorkspaceId);
    if (!ws) throw new Error(`Unknown workspace "${rawWorkspaceId}"`);
    return {
      workspaceId: ws.id,
      path: normalizeRelativePath(rawPath),
    };
  }

  if (rawPath.startsWith('/')) {
    const detected = await detectWorkspaceForAbsolutePath(rawPath);
    if (!detected) {
      throw new Error(`Absolute path "${rawPath}" does not belong to a registered preview workspace`);
    }
    return {
      workspaceId: detected.workspace.id,
      path: normalizeRelativePath(detected.relativePath),
    };
  }

  return {
    workspaceId: listPreviewWorkspaces()[0]?.id || 'devai',
    path: normalizeRelativePath(rawPath),
  };
}

async function buildSummary(rowId: string): Promise<PreviewArtifactSummary> {
  const row = await getPreviewArtifactById(rowId);
  if (!row) {
    throw new Error('Artifact not found');
  }

  let signedUrl: string | undefined;
  let signedUrlExpiresAt: string | undefined;
  if (row.storage_bucket && row.storage_path) {
    const signed = await createPreviewSignedUrl(row.storage_bucket, row.storage_path).catch(() => null);
    if (signed) {
      signedUrl = signed.url;
      signedUrlExpiresAt = signed.expiresAt;
    }
  }

  return {
    id: row.id,
    type: row.artifact_type,
    status: row.status,
    title: row.title,
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error_message,
    mimeType: row.mime_type,
    signedUrl,
    signedUrlExpiresAt,
  };
}

export const previewRoutes: FastifyPluginAsync = async (app) => {
  app.get('/preview/workspaces', async (_request, reply) => {
    return reply.send({
      workspaces: listPreviewWorkspaces().map((workspace) => ({
        id: workspace.id,
        root: workspace.root,
        mode: workspace.mode,
      })),
    });
  });

  app.post<{ Body: CreatePreviewArtifactBody }>('/preview/artifacts', async (request, reply) => {
    const body = request.body || {};
    const sessionId = (body.sessionId || '').trim();
    const type = body.type;

    if (!sessionId) {
      return reply.status(400).send({ error: 'sessionId is required' });
    }
    if (!type) {
      return reply.status(400).send({ error: 'type is required' });
    }

    try {
      await ensureSessionExists(sessionId);

      const sourceFiles: PreviewSourceFile[] = [];
      for (const ref of body.sourceFiles || []) {
        const normalized = await normalizePathRef(ref);
        if (normalized) {
          sourceFiles.push(normalized);
        }
      }

      const derivedMounts: PreviewWorkspaceMount[] = sourceFiles.map((source) => ({
        workspaceId: source.workspaceId,
        path: source.path,
      }));
      const explicitMounts: PreviewWorkspaceMount[] = [];
      for (const ref of body.workspaceMounts || []) {
        const normalized = await normalizePathRef(ref);
        if (normalized) {
          explicitMounts.push(normalized);
        }
      }

      let entrypoint = (body.entrypoint || '').trim() || null;
      if (entrypoint && entrypoint.startsWith('/')) {
        const detected = await detectWorkspaceForAbsolutePath(entrypoint);
        if (detected) {
          entrypoint = `${detected.workspace.id}:${normalizeRelativePath(detected.relativePath)}`;
        }
      }

      const row = await createPreviewArtifact({
        sessionId,
        messageId: body.messageId || null,
        sourceKind: body.sourceKind || 'inline',
        artifactType: type,
        title: body.title || null,
        language: body.language || null,
        entrypoint,
        inlineContent: body.content || null,
        sourceFiles: sourceFiles.length > 0 ? sourceFiles : null,
        workspaceMounts: uniqueMounts([...explicitMounts, ...derivedMounts]),
        metadata: null,
      });

      previewBuildWorker.enqueueBuild(row.id);
      return reply.send({ artifact: await buildSummary(row.id) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  app.get<{ Querystring: { sessionId?: string; limit?: string } }>('/preview/artifacts', async (request, reply) => {
    const sessionId = (request.query.sessionId || '').trim();
    if (!sessionId) {
      return reply.status(400).send({ error: 'sessionId is required' });
    }

    const limit = Number.parseInt(request.query.limit || '20', 10);
    const rows = await listPreviewArtifactsBySession(sessionId, Number.isFinite(limit) ? limit : 20);

    const artifacts = await Promise.all(rows.map((row) => buildSummary(row.id)));
    return reply.send({ artifacts });
  });

  app.get<{ Params: { id: string } }>('/preview/artifacts/:id', async (request, reply) => {
    const id = request.params.id;
    const row = await getPreviewArtifactById(id);
    if (!row) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }
    return reply.send({ artifact: await buildSummary(id) });
  });

  app.post<{ Params: { id: string } }>('/preview/artifacts/:id/rebuild', async (request, reply) => {
    const id = request.params.id;
    const row = await getPreviewArtifactById(id);
    if (!row) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }
    previewBuildWorker.enqueueBuild(id);
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/preview/artifacts/:id/scrape', async (request, reply) => {
    const id = request.params.id;
    const source = await getPreviewArtifactById(id);
    if (!source) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    const scrape = await createPreviewArtifact({
      sessionId: source.session_id,
      messageId: source.message_id,
      sourceKind: 'manual',
      artifactType: 'scrape',
      title: source.title ? `${source.title} (scrape)` : 'scrape',
      language: null,
      entrypoint: null,
      sourceFiles: null,
      workspaceMounts: null,
      inlineContent: null,
      metadata: { sourceArtifactId: source.id },
    });

    previewBuildWorker.enqueueBuild(scrape.id);
    return reply.send({ artifact: await buildSummary(scrape.id) });
  });
};
