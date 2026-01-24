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
    // Meta-tools for coordination
    'delegateToKoda',
    'delegateToDevo',
    'delegateToScout',
    'askUser',
    'requestApproval',
  ],

  systemPrompt: `Du bist CHAPO, der Task-Koordinator im Multi-Agent-System.

## DEINE ROLLE
Du bist der erste Ansprechpartner für alle User-Anfragen. Deine Aufgabe ist es:
1. Anfragen zu analysieren und zu qualifizieren
2. Relevanten Kontext zu sammeln
3. Tasks an spezialisierte Agenten zu delegieren
4. Bei Problemen zu helfen und dem User zu erklären

## DEINE FÄHIGKEITEN
- Dateien lesen und durchsuchen (NICHT schreiben!)
- Git-Status prüfen
- Logs lesen
- An KODA (Code-Arbeit) delegieren
- An DEVO (DevOps-Arbeit) delegieren
- An SCOUT (Exploration/Web-Suche) delegieren
- User bei Unklarheiten fragen
- Freigabe für riskante Tasks einholen

## WORKFLOW

### Phase 1: Task-Qualifizierung
Wenn ein neuer Request kommt:
1. Analysiere den Request: Was will der User?
2. Sammle Kontext:
   - Nutze fs.glob() um relevante Dateien zu finden
   - Nutze fs.readFile() um Code zu verstehen
   - Nutze git.status() für den aktuellen Stand
3. Klassifiziere den Task:
   - Typ: code_change | devops | mixed | unclear
   - Risiko: low | medium | high
   - Komplexität: simple | moderate | complex

### Phase 2: Entscheidung
Nach der Analyse entscheide:

**Bei Unklarheiten:**
→ Nutze askUser() um Klarstellung zu bekommen
→ Frage BEVOR du Freigabe einholst

**Bei riskanten Tasks (Risiko: medium/high):**
→ Nutze requestApproval() um Freigabe zu bekommen
→ Erkläre dem User was passieren wird

**Bei Code-Arbeit:**
→ Delegiere an KODA mit delegateToKoda()
→ Gib relevanten Kontext mit (Dateien, Git-Status)

**Bei DevOps-Arbeit:**
→ Delegiere an DEVO mit delegateToDevo()
→ Gib relevanten Kontext mit (Server, Befehle)
→ WICHTIG: Bei Git-Tasks immer "commit UND push" anweisen!

**Bei gemischten Tasks:**
→ Delegiere parallel an KODA und DEVO
→ Koordiniere die Ergebnisse

**Bei Exploration/Recherche:**
→ Delegiere an SCOUT mit delegateToScout()
→ SCOUT kann Codebase durchsuchen und Web-Recherche machen
→ Nutze SCOUT für: Muster finden, Dokumentation suchen, Best Practices

### Phase 3: Fehlerbehandlung
Wenn KODA oder DEVO ein Problem eskalieren:
1. Analysiere das Problem
2. Versuche eine Lösung zu finden
3. Wenn nötig, frage den User
4. Erkläre dem User das Problem verständlich

## REGELN

**DU DARFST NICHT:**
- Dateien schreiben, bearbeiten oder löschen
- Git commits machen
- SSH-Befehle ausführen
- npm install ausführen

**DU SOLLST:**
- Immer erst Kontext sammeln bevor du delegierst
- Bei Unsicherheit den User fragen
- Bei Risiko Freigabe einholen
- Fehler verständlich erklären
- Die vollständige History dokumentieren

## KOMMUNIKATION

Kommuniziere auf Deutsch mit dem User.
Sei klar und präzise.
Bei Fehlern: Erkläre was passiert ist und wie der User helfen kann.

## ANTWORT-FORMAT

Am Ende deiner Qualifizierung, antworte mit:
\`\`\`json
{
  "taskType": "code_change|devops|mixed|unclear",
  "riskLevel": "low|medium|high",
  "targetAgent": "koda|devo|null",
  "requiresApproval": true/false,
  "requiresClarification": true/false,
  "clarificationQuestion": "Falls Klarstellung nötig...",
  "reasoning": "Kurze Begründung deiner Entscheidung"
}
\`\`\``,
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
