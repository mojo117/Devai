import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';
import type { MemoryCandidate, MemoryPriority } from './types.js';
import { generateEmbedding } from './embeddings.js';
import { findSimilarMemories, insertMemory, supersedeMemory } from './memoryStore.js';

// ---------------------------------------------------------------------------
// Extraction prompt (German) — instructs the LLM to distill learnings
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `Du bist ein Memory-Extraction-Agent. Deine Aufgabe ist es, wertvolle Erkenntnisse aus Konversationen zu destillieren.

Analysiere den folgenden Konversationstext und extrahiere alle relevanten Learnings als JSON-Array.

Jedes Element im Array hat folgende Felder:
- "content": Die Erkenntnis als klarer, eigenständiger Satz (deutsch oder englisch, je nach Kontext)
- "type": Einer von "semantic" (Fakten/Wissen), "episodic" (Erfahrungen/Ereignisse), "procedural" (Anleitungen/Workflows)
- "namespace": Hierarchischer Pfad, z.B. "devai/project/taskforge/deployment" oder "devai/techstack/appwrite"
- "source": Einer von "user_stated" (User hat es gesagt), "error_resolution" (Fehler wurde gelöst), "pattern" (wiederkehrendes Muster erkannt), "discovery" (neue Entdeckung)
- "priority": Einer von "highest" (User-Korrekturen, kritische Fehler), "high" (wichtige Learnings), "medium" (nützlich), "low" (nice-to-know)

Regeln:
- User-Korrekturen haben IMMER "highest" Priorität und source "user_stated"
- Filtere Smalltalk, Begrüßungen und irrelevante Konversation heraus
- Filtere verbose Ausgaben, Log-Dumps und tote Enden heraus
- Fasse keine halben Erkenntnisse zusammen — nur vollständige, verifizierte Learnings
- Jede Erkenntnis muss ohne Kontext verständlich sein (eigenständig formuliert)
- Gib NUR das JSON-Array zurück, keine Erklärungen

Wenn es keine extrahierbaren Learnings gibt, gib ein leeres Array zurück: []`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractionResult {
  added: number;
  updated: number;
  skipped: number;
  candidates: number;
}

// ---------------------------------------------------------------------------
// Phase 1: Extract memory candidates from conversation text via LLM
// ---------------------------------------------------------------------------

export async function extractMemoryCandidates(
  conversationText: string,
  provider: LLMProvider = 'zai',
): Promise<MemoryCandidate[]> {
  try {
    const response = await llmRouter.generateWithFallback(provider, {
      model: 'glm-4.7-flash',
      systemPrompt: EXTRACTION_PROMPT,
      messages: [
        {
          role: 'user',
          content: conversationText,
        },
      ],
      tools: [],
      toolsEnabled: false,
    });

    const rawContent = response.content.trim();

    // Extract JSON from the response — it may be wrapped in ```json``` code blocks
    let jsonString = rawContent;
    const codeBlockMatch = rawContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1].trim();
    }

    const parsed: unknown = JSON.parse(jsonString);

    if (!Array.isArray(parsed)) {
      console.error('[extraction] LLM response is not a JSON array:', typeof parsed);
      return [];
    }

    // Validate and normalize each candidate
    const validTypes = new Set(['semantic', 'episodic', 'procedural']);
    const validSources = new Set(['user_stated', 'error_resolution', 'pattern', 'discovery']);
    const validPriorities = new Set(['highest', 'high', 'medium', 'low']);

    const candidates: MemoryCandidate[] = [];

    for (const item of parsed) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as Record<string, unknown>).content !== 'string' ||
        !(item as Record<string, unknown>).content
      ) {
        continue;
      }

      const raw = item as Record<string, unknown>;

      const type = validTypes.has(raw.type as string)
        ? (raw.type as MemoryCandidate['type'])
        : 'semantic';

      const source = validSources.has(raw.source as string)
        ? (raw.source as MemoryCandidate['source'])
        : 'discovery';

      const priority = validPriorities.has(raw.priority as string)
        ? (raw.priority as MemoryPriority)
        : 'medium';

      candidates.push({
        content: String(raw.content),
        type,
        namespace: typeof raw.namespace === 'string' ? raw.namespace : 'devai/general',
        source,
        priority,
      });
    }

    console.log(`[extraction] Extracted ${candidates.length} memory candidates from conversation`);
    return candidates;
  } catch (err) {
    console.error('[extraction] extractMemoryCandidates failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Deduplicate candidates against existing memories and store
// ---------------------------------------------------------------------------

export async function deduplicateAndStore(
  candidates: MemoryCandidate[],
  sessionId?: string,
): Promise<{ added: number; updated: number; skipped: number }> {
  const result = { added: 0, updated: 0, skipped: 0 };

  for (const candidate of candidates) {
    try {
      const similar = await findSimilarMemories(candidate.content, candidate.namespace);

      if (similar.length === 0) {
        // ADD — no existing match
        const embedding = await generateEmbedding(candidate.content);
        const newId = await insertMemory({
          content: candidate.content,
          embedding,
          memory_type: candidate.type,
          namespace: candidate.namespace,
          priority: candidate.priority ?? 'medium',
          source: candidate.source,
          session_id: sessionId,
        });

        if (newId) {
          result.added++;
        }
        continue;
      }

      const topMatch = similar[0];

      if (topMatch.similarity > 0.95) {
        // NOOP — already known, skip
        result.skipped++;
        continue;
      }

      // UPDATE — similarity between 0.8 and 0.95, insert new and supersede old
      const embedding = await generateEmbedding(candidate.content);
      const newId = await insertMemory({
        content: candidate.content,
        embedding,
        memory_type: candidate.type,
        namespace: candidate.namespace,
        priority: candidate.priority ?? 'medium',
        source: candidate.source,
        session_id: sessionId,
      });

      if (newId) {
        await supersedeMemory(topMatch.id, newId);
        result.updated++;
      }
    } catch (err) {
      console.error(`[extraction] deduplicateAndStore failed for candidate "${candidate.content.slice(0, 60)}...":`, err);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Full pipeline: extract -> deduplicate -> store
// ---------------------------------------------------------------------------

export async function runExtractionPipeline(
  conversationText: string,
  sessionId?: string,
  provider: LLMProvider = 'zai',
): Promise<ExtractionResult> {
  console.log('[extraction] Starting extraction pipeline...');

  // Phase 1: Extract candidates
  const candidates = await extractMemoryCandidates(conversationText, provider);

  if (candidates.length === 0) {
    console.log('[extraction] No candidates extracted, pipeline complete.');
    return { added: 0, updated: 0, skipped: 0, candidates: 0 };
  }

  // Phase 2: Deduplicate and store
  const storeResult = await deduplicateAndStore(candidates, sessionId);

  const result: ExtractionResult = {
    ...storeResult,
    candidates: candidates.length,
  };

  console.log(
    `[extraction] Pipeline complete: ${result.candidates} candidates -> ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`,
  );

  return result;
}
