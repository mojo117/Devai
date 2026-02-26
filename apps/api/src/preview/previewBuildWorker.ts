import { mkdtemp, mkdir, readFile, rm, stat, writeFile, cp as copyPath } from 'fs/promises';
import { join, dirname, extname, basename } from 'path';
import { tmpdir } from 'os';
import ts from 'typescript';
import {
  createPreviewArtifact,
  getPreviewArtifactById,
  updatePreviewArtifact,
  type CreatePreviewArtifactParams,
} from '../db/previewArtifactQueries.js';
import type { PreviewArtifactType, PreviewSourceFile, PreviewWorkspaceMount } from './types.js';
import { config } from '../config.js';
import { resolveWorkspacePath } from './workspaceRegistry.js';
import { createPreviewSignedUrl, uploadPreviewObject } from '../services/previewStorageService.js';

type PreviewJobMode = 'build';

interface PreviewJob {
  artifactId: string;
  mode: PreviewJobMode;
}

interface BuildResult {
  filename: string;
  mimeType: string;
  content: Buffer | string;
}

class PreviewBuildWorker {
  private queue: PreviewJob[] = [];
  private running = false;
  private processing = false;

  start(): void {
    this.running = true;
    this.kick();
  }

  stop(): void {
    this.running = false;
  }

  enqueueBuild(artifactId: string): void {
    this.queue.push({ artifactId, mode: 'build' });
    this.kick();
  }

  async createAndQueueArtifact(params: CreatePreviewArtifactParams): Promise<{ artifactId: string }> {
    const row = await createPreviewArtifact(params);
    this.enqueueBuild(row.id);
    return { artifactId: row.id };
  }

  private kick(): void {
    if (!this.running || this.processing) return;
    this.processing = true;
    setImmediate(() => {
      void this.processLoop();
    });
  }

  private async processLoop(): Promise<void> {
    while (this.running && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) continue;
      await this.processJob(next).catch((err) => {
        console.error('[preview-worker] job failed unexpectedly:', err);
      });
    }
    this.processing = false;
    if (this.running && this.queue.length > 0) {
      this.kick();
    }
  }

  private async processJob(job: PreviewJob): Promise<void> {
    const artifact = await getPreviewArtifactById(job.artifactId);
    if (!artifact) return;

    await updatePreviewArtifact(artifact.id, { status: 'building', errorMessage: null });

    try {
      const result = await withTimeout(this.buildArtifact(artifact.id), config.previewBuildTimeoutMs);
      const stored = await uploadPreviewObject(artifact.id, result.filename, result.content, result.mimeType);
      await updatePreviewArtifact(artifact.id, {
        status: 'ready',
        storageBucket: stored.bucket,
        storagePath: stored.path,
        mimeType: stored.mimeType,
        errorMessage: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updatePreviewArtifact(artifact.id, { status: 'failed', errorMessage: message });
    }
  }

  private async buildArtifact(artifactId: string): Promise<BuildResult> {
    const artifact = await getPreviewArtifactById(artifactId);
    if (!artifact) throw new Error('Artifact not found');

    switch (artifact.artifact_type) {
      case 'html':
        return {
          filename: 'index.html',
          mimeType: 'text/html; charset=utf-8',
          content: artifact.inline_content || '',
        };
      case 'svg':
        return {
          filename: 'preview.svg',
          mimeType: 'image/svg+xml',
          content: artifact.inline_content || '',
        };
      case 'pdf':
        return this.buildPdfArtifact(artifact.source_files || [], artifact.inline_content || null);
      case 'webapp':
        return this.buildWebappArtifact({
          language: artifact.language || undefined,
          inlineContent: artifact.inline_content || null,
          sourceFiles: artifact.source_files || [],
          mounts: artifact.workspace_mounts || [],
          entrypoint: artifact.entrypoint || null,
        });
      case 'scrape':
        return this.buildScrapeArtifact(artifact.metadata || {});
      default:
        throw new Error(`Unsupported artifact type: ${String(artifact.artifact_type)}`);
    }
  }

  private async buildPdfArtifact(sourceFiles: PreviewSourceFile[], inlineContent: string | null): Promise<BuildResult> {
    if (sourceFiles.length > 0) {
      const first = sourceFiles[0];
      const resolved = await resolveWorkspacePath(first.workspaceId, first.path);
      const file = await readFile(resolved.absolutePath);
      return {
        filename: basename(first.path) || 'preview.pdf',
        mimeType: 'application/pdf',
        content: file,
      };
    }

    if (!inlineContent) {
      throw new Error('PDF artifact has no source file and no inline content');
    }

    const base64 = inlineContent.startsWith('data:application/pdf;base64,')
      ? inlineContent.slice('data:application/pdf;base64,'.length)
      : inlineContent.trim();
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.toString('utf-8', 0, 4).startsWith('%PDF')) {
      throw new Error('Inline PDF content is not valid base64-encoded PDF data');
    }

    return {
      filename: 'preview.pdf',
      mimeType: 'application/pdf',
      content: buffer,
    };
  }

  private async buildWebappArtifact(params: {
    language?: string;
    inlineContent: string | null;
    sourceFiles: PreviewSourceFile[];
    mounts: PreviewWorkspaceMount[];
    entrypoint: string | null;
  }): Promise<BuildResult> {
    const tempRoot = await mkdtemp(join(tmpdir(), 'devai-preview-'));
    try {
      const mountsRoot = join(tempRoot, 'mounts');
      await mkdir(mountsRoot, { recursive: true });

      await this.copyWorkspaceMounts(params.mounts, mountsRoot);
      const entrypoint = await this.resolveEntrypoint({
        tempRoot,
        mountsRoot,
        sourceFiles: params.sourceFiles,
        inlineContent: params.inlineContent,
        language: params.language,
        explicitEntrypoint: params.entrypoint,
      });

      const ext = extname(entrypoint).toLowerCase();
      if (ext === '.html' || ext === '.htm') {
        const html = await readFile(entrypoint, 'utf-8');
        return {
          filename: 'index.html',
          mimeType: 'text/html; charset=utf-8',
          content: html,
        };
      }

      const bundled = await this.bundleWithEsbuild(entrypoint);
      let jsOutput = bundled;
      if (!jsOutput) {
        const source = await readFile(entrypoint, 'utf-8');
        jsOutput = ts.transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
          fileName: entrypoint,
        }).outputText;
      }

      const html = buildWebappHtml(jsOutput);
      return {
        filename: 'index.html',
        mimeType: 'text/html; charset=utf-8',
        content: html,
      };
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async buildScrapeArtifact(metadata: Record<string, unknown>): Promise<BuildResult> {
    const sourceArtifactId = typeof metadata.sourceArtifactId === 'string' ? metadata.sourceArtifactId : null;
    if (!sourceArtifactId) {
      throw new Error('Scrape artifact metadata must include sourceArtifactId');
    }

    const sourceArtifact = await getPreviewArtifactById(sourceArtifactId);
    if (!sourceArtifact) {
      throw new Error(`Source artifact not found: ${sourceArtifactId}`);
    }

    let screenshot: Buffer | null = null;
    if (sourceArtifact.storage_bucket && sourceArtifact.storage_path) {
      screenshot = await this.tryPlaywrightScreenshotFromStoredArtifact(sourceArtifact.storage_bucket, sourceArtifact.storage_path);
    } else if (sourceArtifact.inline_content) {
      screenshot = await this.tryPlaywrightScreenshotFromHtml(sourceArtifact.inline_content);
    }

    if (!screenshot) {
      throw new Error('Scrape fallback requires Playwright runtime and a renderable source artifact');
    }

    return {
      filename: 'scrape.png',
      mimeType: 'image/png',
      content: screenshot,
    };
  }

  private async tryPlaywrightScreenshotFromStoredArtifact(bucket: string, storagePath: string): Promise<Buffer | null> {
    const urlData = await createPreviewSignedUrl(bucket, storagePath, 120).catch(() => null);
    if (!urlData) return null;
    return this.tryPlaywrightScreenshotFromUrl(urlData.url);
  }

  private async tryPlaywrightScreenshotFromHtml(html: string): Promise<Buffer | null> {
    const runtime = await loadPlaywrightRuntime();
    if (!runtime) return null;

    const browser = await runtime.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      return await page.screenshot({ type: 'png', fullPage: true });
    } finally {
      await browser.close();
    }
  }

  private async tryPlaywrightScreenshotFromUrl(url: string): Promise<Buffer | null> {
    const runtime = await loadPlaywrightRuntime();
    if (!runtime) return null;

    const browser = await runtime.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
      return await page.screenshot({ type: 'png', fullPage: true });
    } finally {
      await browser.close();
    }
  }

  private async copyWorkspaceMounts(mounts: PreviewWorkspaceMount[], mountsRoot: string): Promise<void> {
    let copiedBytes = 0;
    for (const mount of mounts) {
      const resolved = await resolveWorkspacePath(mount.workspaceId, mount.path);
      const destination = join(mountsRoot, mount.workspaceId, mount.path);
      await mkdir(dirname(destination), { recursive: true });
      await copyPath(resolved.absolutePath, destination, { recursive: true, force: true });
      copiedBytes += await getPathSize(destination);
      if (copiedBytes > config.previewMaxMountBytes) {
        throw new Error(`Preview mount size exceeded limit (${config.previewMaxMountBytes} bytes)`);
      }
    }
  }

  private async resolveEntrypoint(params: {
    tempRoot: string;
    mountsRoot: string;
    sourceFiles: PreviewSourceFile[];
    inlineContent: string | null;
    language?: string;
    explicitEntrypoint: string | null;
  }): Promise<string> {
    if (params.explicitEntrypoint) {
      const parsed = parseWorkspaceRef(params.explicitEntrypoint);
      if (parsed) {
        return join(params.mountsRoot, parsed.workspaceId, parsed.path);
      }
      const maybeLocal = join(params.tempRoot, params.explicitEntrypoint);
      if (await exists(maybeLocal)) return maybeLocal;
    }

    if (params.sourceFiles.length > 0) {
      const first = params.sourceFiles[0];
      return join(params.mountsRoot, first.workspaceId, first.path);
    }

    if (params.inlineContent) {
      const inferredExt = inferFileExtension(params.language);
      const inlinePath = join(params.tempRoot, `inline-entry${inferredExt}`);
      await writeFile(inlinePath, params.inlineContent, 'utf-8');
      return inlinePath;
    }

    throw new Error('Webapp artifact has no entrypoint or content');
  }

  private async bundleWithEsbuild(entrypoint: string): Promise<string | null> {
    const runtime = await loadEsbuildRuntime();
    if (!runtime?.build) return null;

    const result = await runtime.build({
      entryPoints: [entrypoint],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      target: ['es2022'],
      loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.js': 'js',
        '.jsx': 'jsx',
        '.json': 'json',
      },
    });

    const outputFile = result.outputFiles?.[0];
    return outputFile?.text || null;
  }
}

function buildWebappHtml(jsCode: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Devai Preview</title>
  <style>
    html, body { margin: 0; padding: 0; min-height: 100%; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #09130f; color: #effcf4; }
    #app { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module">${jsCode}</script>
</body>
</html>`;
}

function inferFileExtension(language?: string): string {
  const normalized = (language || '').toLowerCase();
  if (normalized === 'tsx') return '.tsx';
  if (normalized === 'ts' || normalized === 'typescript') return '.ts';
  if (normalized === 'jsx') return '.jsx';
  if (normalized === 'html') return '.html';
  return '.js';
}

function parseWorkspaceRef(value: string): { workspaceId: string; path: string } | null {
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const workspaceId = value.slice(0, idx).trim();
  const rawPath = value.slice(idx + 1).trim().replace(/^\/+/, '');
  if (!workspaceId || !rawPath || rawPath.includes('..')) return null;
  const path = rawPath.split('/').filter(Boolean).join('/');
  return { workspaceId, path };
}

async function getPathSize(path: string): Promise<number> {
  const fileStat = await stat(path);
  if (fileStat.isFile()) return fileStat.size;
  if (!fileStat.isDirectory()) return 0;

  const fs = await import('fs/promises');
  const entries = await fs.readdir(path);
  let total = 0;
  for (const entry of entries) {
    total += await getPathSize(join(path, entry));
  }
  return total;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let handle: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    handle = setTimeout(() => reject(new Error(`Preview build timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

async function loadEsbuildRuntime(): Promise<{ build: (options: Record<string, unknown>) => Promise<{ outputFiles?: Array<{ text?: string }> }> } | null> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;
    const mod = await dynamicImport('esbuild');
    const build = mod.build as ((options: Record<string, unknown>) => Promise<{ outputFiles?: Array<{ text?: string }> }>) | undefined;
    return build ? { build } : null;
  } catch {
    return null;
  }
}

async function loadPlaywrightRuntime(): Promise<{ chromium: { launch: (opts: Record<string, unknown>) => Promise<{ newPage: (opts: Record<string, unknown>) => Promise<{ goto: (url: string, opts: Record<string, unknown>) => Promise<void>; setContent: (html: string, opts: Record<string, unknown>) => Promise<void>; screenshot: (opts: Record<string, unknown>) => Promise<Buffer>; }>; close: () => Promise<void>; }>; } } | null> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;
    const mod = await dynamicImport('playwright');
    const chromium = mod.chromium as { launch: (opts: Record<string, unknown>) => Promise<{ newPage: (opts: Record<string, unknown>) => Promise<{ goto: (url: string, opts: Record<string, unknown>) => Promise<void>; setContent: (html: string, opts: Record<string, unknown>) => Promise<void>; screenshot: (opts: Record<string, unknown>) => Promise<Buffer>; }>; close: () => Promise<void>; }> } | undefined;
    return chromium ? { chromium } : null;
  } catch {
    return null;
  }
}

export const previewBuildWorker = new PreviewBuildWorker();
