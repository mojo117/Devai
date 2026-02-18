/**
 * CHAPO - Task Coordinator Agent
 *
 * Role: Analyzes incoming requests, gathers context, qualifies tasks,
 * and delegates to KODA or DEVO. Has read-only access to the codebase.
 */

import type { AgentDefinition } from './types.js';

export const CHAPO_AGENT: AgentDefinition = {
  name: 'chapo',
  role: 'Task Coordinator',
  model: 'claude-opus-4-5-20251101', // Claude Opus 4.5 - most capable
  fallbackModel: 'claude-sonnet-4-20250514', // Fallback if Opus unavailable

  capabilities: {
    readOnly: true,
    canDelegateToKoda: true,
    canDelegateToDevo: true,
    canDelegateToScout: true,
    canAskUser: true,
    canRequestApproval: true,
  },

  tools: [
    // Read-only file system tools
    'fs_listFiles',
    'fs_readFile',
    'fs_glob',
    'fs_grep',
    // Git status (read-only)
    'git_status',
    'git_diff',
    // GitHub (read-only)
    'github_getWorkflowRunStatus',
    // Logs
    'logs_getStagingLogs',
    // Workspace memory
    'memory_remember',
    'memory_search',
    'memory_readToday',
    // Meta-tools for coordination
    'delegateToKoda',
    'delegateToDevo',
    'delegateToScout',
    'askUser',
    'requestApproval',
  ],

  systemPrompt: `Du bist CHAPO, der Task-Koordinator im Multi-Agent-System.

## KERNPRINZIP: HANDLE ZUERST, FRAGE SPÄTER

Wie Claude Code: Führe bei klaren Requests SOFORT das passende Tool aus.
Frage den User NUR wenn du nach der Ausführung nicht weiterweißt.

## DEINE FÄHIGKEITEN
- Dateien lesen und durchsuchen (fs_listFiles, fs_readFile, fs_glob, fs_grep)
- Git-Status prüfen (git_status, git_diff)
- Logs lesen (logs_getStagingLogs)
- Memory speichern/suchen (memory_remember, memory_search, memory_readToday)
- An KODA delegieren (Code-Änderungen)
- An DEVO delegieren (DevOps-Tasks)
- An SCOUT delegieren (tiefe Exploration, Web-Suche)

## DATEISYSTEM-ZUGRIFF (EINGESCHRÄNKT)
- Erlaubte Root-Pfade (canonical):
  - /opt/Klyde/projects/DeviSpace
  - /opt/Klyde/projects/Devai
- Andere Pfade/Repos nicht anfassen.

## DEFAULT FUER "BAU MIR EINE WEBSITE/APP"
- Wenn der User eine neue Demo-Website (z.B. "Hello World") will und NICHT explizit sagt "ersetze DevAI UI",
  dann erstelle sie als neues Projekt in DeviSpace (z.B. /opt/Klyde/projects/DeviSpace/repros/<name>).
- Ueberschreibe NICHT apps/web/src/App.tsx oder apps/web/index.html fuer so eine Anfrage.

## WORKFLOW

### 1. READ-ONLY REQUESTS → SOFORT AUSFÜHREN

Bei diesen Anfragen führst du das Tool DIREKT aus ohne zu fragen:

| User sagt | Du machst |
|-----------|-----------|
| "Was liegt im Verzeichnis X?" | fs_listFiles({ path: "X" }) |
| "Zeig mir Datei Y" | fs_readFile({ path: "Y" }) |
| "Finde alle *.ts Dateien" | fs_glob({ pattern: "**/*.ts" }) |
| "Suche nach 'TODO'" | fs_grep({ pattern: "TODO" }) |
| "Git Status" | git_status() |
| "Was hat sich geändert?" | git_diff() |

### 2. ÄNDERUNGS-REQUESTS → DELEGIEREN

Bei Änderungen delegierst du an den passenden Agenten:

| Anfrage | Agent | Tool |
|---------|-------|------|
| "Erstelle Datei X" | KODA | delegateToKoda() |
| "Ändere Code in Y" | KODA | delegateToKoda() |
| "Commit und push" | DEVO | delegateToDevo() |
| "npm install" | DEVO | delegateToDevo() |
| "PM2 restart" | DEVO | delegateToDevo() |

### 3. WEB-SUCHE & RECHERCHE → SCOUT SPAWNEN

**WICHTIG:** Bei JEDER Frage nach aktuellen Informationen SOFORT an SCOUT delegieren:

| Anfrage | Aktion |
|---------|--------|
| "Wie ist das Wetter in X?" | delegateToScout({ query: "Wetter X", scope: "web" }) |
| "Was sind die News zu Y?" | delegateToScout({ query: "News Y", scope: "web" }) |
| "Aktuelle Version von Z?" | delegateToScout({ query: "aktuelle Z Version", scope: "web" }) |
| "Best practices für Y" | delegateToScout({ query: "Y best practices", scope: "web" }) |
| "Wie funktioniert X im Projekt?" | delegateToScout({ query: "...", scope: "codebase" }) |

**Erkennungsmerkmale für Web-Suche:**
- Wetter, Temperatur, Vorhersage
- Aktuelle Nachrichten, News
- Preise, Kurse, Statistiken
- "Was ist...", "Wer ist...", "Wann..."
- Externe Dokumentation, Tutorials

## WANN FRAGEN?

Frage den User NUR wenn:
1. Das Tool-Ergebnis mehrdeutig ist
2. Es mehrere gleichwertige Optionen gibt
3. Eine riskante Aktion (high risk) ansteht

NIEMALS fragen bei:
- Klaren Datei-Operationen
- Einfachen Suchen
- Wenn du durch Tool-Ausführung die Antwort bekommst

## KOMMUNIKATION

Auf Deutsch kommunizieren.
Ergebnisse direkt zeigen.
Kurz und präzise sein.

## ANTWORT-FORMAT

Bei Delegation an andere Agenten, antworte mit:
\`\`\`json
{
  "taskType": "code_change|devops|exploration|mixed|unclear",
  "riskLevel": "low|medium|high",
  "targetAgent": "koda|devo|chapo|null",
  "requiresApproval": true/false,
  "requiresClarification": false,
  "reasoning": "Kurze Begründung"
}
\`\`\`

Bei Read-Only Requests: Führe das Tool aus und zeige das Ergebnis OHNE JSON.`,
};

// Tool definitions for CHAPO-specific meta-tools
export const CHAPO_META_TOOLS = [
  {
    name: 'delegateToKoda',
    description: 'Delegiere Code-Arbeit an KODA (Senior Developer). Nutze dies für: Dateien erstellen/bearbeiten/löschen, Code refactoring, neue Features implementieren.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Beschreibung der Aufgabe für KODA',
        },
        context: {
          type: 'object',
          description: 'Gesammelter Kontext (relevante Dateien, Code-Snippets)',
        },
        files: {
          type: 'array',
          description: 'Liste relevanter Dateipfade',
        },
        constraints: {
          type: 'array',
          description: 'Einschränkungen oder besondere Anweisungen',
        },
      },
      required: ['task'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'delegateToDevo',
    description: 'Delegiere DevOps-Arbeit an DEVO (DevOps Engineer). Nutze dies für: Git operations, npm commands, SSH, PM2, GitHub Actions.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Beschreibung der Aufgabe für DEVO',
        },
        context: {
          type: 'object',
          description: 'Gesammelter Kontext (Server-Info, Git-Status)',
        },
        commands: {
          type: 'array',
          description: 'Vorgeschlagene Befehle (optional)',
        },
        constraints: {
          type: 'array',
          description: 'Einschränkungen oder besondere Anweisungen',
        },
      },
      required: ['task'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'delegateToScout',
    description: 'Delegiere Exploration/Recherche an SCOUT. Nutze dies für: Codebase durchsuchen, Web-Recherche, Dokumentation finden, Muster erkennen.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Was soll SCOUT suchen/erforschen?',
        },
        scope: {
          type: 'string',
          enum: ['codebase', 'web', 'both'],
          description: 'Wo soll gesucht werden? (default: both)',
        },
        context: {
          type: 'string',
          description: 'Zusätzlicher Kontext für die Suche (optional)',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'askUser',
    description: 'Stelle dem User eine Frage bei Unklarheiten. Nutze dies BEVOR du Freigabe einholst.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Die Frage an den User',
        },
        options: {
          type: 'array',
          description: 'Mögliche Antworten (optional)',
        },
        context: {
          type: 'string',
          description: 'Zusätzlicher Kontext für den User',
        },
      },
      required: ['question'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'requestApproval',
    description: 'Fordere Freigabe vom User für einen riskanten Task. Nutze dies bei medium/high Risiko.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Beschreibung was getan werden soll',
        },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Risiko-Level des Tasks',
        },
        actions: {
          type: 'array',
          description: 'Liste der geplanten Aktionen',
        },
      },
      required: ['description', 'riskLevel'],
    },
    requiresConfirmation: false,
  },
];
