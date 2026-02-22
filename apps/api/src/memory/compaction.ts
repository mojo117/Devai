import type { LLMMessage, LLMProvider } from '../llm/types.js';
import { llmRouter } from '../llm/router.js';
import { runExtractionPipeline } from './extraction.js';

// ---------------------------------------------------------------------------
// Compaction prompt — instructs the LLM to produce a structured summary
// and memory candidates from a conversation transcript.
// ---------------------------------------------------------------------------
const COMPACTION_PROMPT = `Du bist ein Kontext-Kompaktierungs-Assistent. Deine Aufgabe ist es, eine lange Konversation zwischen einem Benutzer und einem KI-Assistenten zusammenzufassen.

Erstelle ZWEI Teile:

TEIL 1 — ZUSAMMENFASSUNG (3.000–5.000 Zeichen):
Bewahre:
- Alle getroffenen Entscheidungen und deren Begründungen
- Ergebnisse von Tool-Aufrufen (Dateien erstellt, Befehle ausgeführt, API-Antworten)
- Offene Fragen und ungelöste Probleme
- Aktueller Arbeitsstand und nächste Schritte
- Wichtige Code-Snippets oder Konfigurationen, die noch relevant sind
- Fehlermeldungen und deren Lösungen

Verwerfe:
- Vollständige Dateiinhalte (nur Dateinamen und relevante Änderungen behalten)
- Ausführliche Bash-Ausgaben (nur Ergebnis/Status behalten)
- Wiederholte fehlgeschlagene Versuche (nur den letzten Versuch und die Lösung behalten)
- Höflichkeitsfloskeln und Smalltalk
- Redundante Informationen

TEIL 2 — MEMORY-KANDIDATEN:
Extrahiere Fakten, die langfristig nützlich sein könnten, als JSON-Array. Jeder Eintrag hat:
- "fact": Der Fakt als kurzer Satz
- "category": Eine Kategorie (z.B. "user_preference", "project_setup", "bug_fix", "architecture", "workflow")

Beispiel:
[
  {"fact": "Benutzer bevorzugt Tailwind CSS gegenüber styled-components", "category": "user_preference"},
  {"fact": "Projekt nutzt Appwrite als Backend mit Project-ID 69805803000aeddb2ead", "category": "project_setup"}
]

Antworte EXAKT in diesem Format:

---SUMMARY---
[Deine Zusammenfassung hier]
---MEMORIES---
[JSON-Array der Memory-Kandidaten]`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CompactionResult {
  summary: string;
  droppedTokens: number;
  summaryTokens: number;
}

// ---------------------------------------------------------------------------
// compactMessages — compresses a conversation into a summary + memories
// ---------------------------------------------------------------------------
export async function compactMessages(
  messages: LLMMessage[],
  sessionId: string,
  provider?: LLMProvider,
): Promise<CompactionResult> {
  // Concatenate all messages into a transcript
  const transcript = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n\n');

  // Rough token estimate (1 token ~ 4 chars)
  const droppedTokens = Math.ceil(transcript.length / 4);

  console.log(
    `[compaction] Starting compaction for session ${sessionId} — ${messages.length} messages, ~${droppedTokens} tokens`,
  );

  try {
    const response = await llmRouter.generateWithFallback(
      provider ?? 'zai',
      {
        model: 'glm-4.7-flash',
        messages: [
          {
            role: 'user',
            content: `Hier ist die Konversation zum Kompaktieren:\n\n${transcript}`,
          },
        ],
        systemPrompt: COMPACTION_PROMPT,
        maxTokens: 4096,
      },
    );

    const raw = response.content;

    // Parse the structured response
    const summaryMatch = raw.split('---SUMMARY---');
    const afterSummary = summaryMatch.length > 1 ? summaryMatch[1] : raw;

    const memoriesMatch = afterSummary.split('---MEMORIES---');
    const summary = (memoriesMatch[0] ?? '').trim();
    const memoriesRaw = memoriesMatch.length > 1 ? (memoriesMatch[1] ?? '').trim() : '';

    const summaryTokens = Math.ceil(summary.length / 4);

    console.log(
      `[compaction] Compaction complete — summary: ~${summaryTokens} tokens, dropped: ~${droppedTokens} tokens`,
    );

    // Fire-and-forget: run extraction pipeline on the memories section
    if (memoriesRaw.length > 0) {
      runExtractionPipeline(memoriesRaw, sessionId, provider ?? 'zai').catch(
        (err: unknown) => {
          console.error(
            `[compaction] Extraction pipeline failed for session ${sessionId}:`,
            err instanceof Error ? err.message : String(err),
          );
        },
      );
    }

    return {
      summary,
      droppedTokens,
      summaryTokens,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[compaction] Compaction failed for session ${sessionId}: ${errorMsg}`,
    );

    // Fallback: return a minimal summary so the conversation can continue
    const fallbackSummary = '[Context wurde kompaktiert.]';
    return {
      summary: fallbackSummary,
      droppedTokens,
      summaryTokens: Math.ceil(fallbackSummary.length / 4),
    };
  }
}
