import type { ToolDefinition } from '../registry.js';

export const communicationTools: ToolDefinition[] = [
  // TaskForge Tools (CAIO agent)
  {
    name: 'taskforge_list_tasks',
    description: 'Liste Tasks aus TaskForge auf. Verfuegbare Projekte: devai, founders-forge, taskflow, dieda, clawd. Default: devai.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Projektname: devai, founders-forge, taskflow, dieda, clawd (default: devai)' },
        status: { type: 'string', description: 'Status-Filter: initiierung, planung, umsetzung, review, done (optional)' },
      },
    },
    requiresConfirmation: false,
  },
  {
    name: 'taskforge_get_task',
    description: 'Hole Details zu einem bestimmten Task aus TaskForge.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Die Task-ID oder Display-ID (z.B. Devai:abc1234)' },
        project: { type: 'string', description: 'Projektname (default: devai). Nur noetig wenn taskId keine Display-ID ist.' },
      },
      required: ['taskId'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'taskforge_create_task',
    description: 'Erstelle einen neuen Task in TaskForge. Verfuegbare Projekte: devai, founders-forge, taskflow, dieda, clawd.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task-Titel (imperativ)' },
        description: { type: 'string', description: 'Detaillierte Beschreibung mit Akzeptanzkriterien' },
        status: { type: 'string', description: 'Initialer Status (default: initiierung)', enum: ['initiierung', 'planung', 'umsetzung', 'review'] },
        project: { type: 'string', description: 'Projektname (default: devai)' },
      },
      required: ['title', 'description'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'taskforge_move_task',
    description: 'Verschiebe einen Task in einen neuen Status.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Die Task-ID' },
        newStatus: { type: 'string', description: 'Neuer Status', enum: ['initiierung', 'planung', 'umsetzung', 'review', 'done'] },
        project: { type: 'string', description: 'Projektname (default: devai)' },
      },
      required: ['taskId', 'newStatus'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'taskforge_add_comment',
    description: 'Füge einen Kommentar zu einem TaskForge-Task hinzu.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Die Task-ID' },
        comment: { type: 'string', description: 'Der Kommentar-Text' },
        project: { type: 'string', description: 'Projektname (default: devai)' },
      },
      required: ['taskId', 'comment'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'taskforge_search',
    description: 'Suche nach Tasks in TaskForge. Verfuegbare Projekte: devai, founders-forge, taskflow, dieda, clawd.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Suchbegriff' },
        project: { type: 'string', description: 'Projektname (default: devai)' },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },

  // Email Tool (CAIO agent)
  {
    name: 'send_email',
    description: 'Sende eine E-Mail über Resend.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Empfänger E-Mail-Adresse' },
        subject: { type: 'string', description: 'Betreff der E-Mail' },
        body: { type: 'string', description: 'Text-Inhalt der E-Mail' },
        replyTo: { type: 'string', description: 'Reply-To Adresse (optional)' },
      },
      required: ['to', 'subject', 'body'],
    },
    requiresConfirmation: true,
  },

  // Telegram Document Tool (CAIO agent)
  {
    name: 'telegram_send_document',
    description: 'Sende ein Dokument/eine Datei an den Benutzer via Telegram. Quellen: Dateisystem (path), Supabase Storage (fileId), oder URL.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Dateiquelle: "filesystem" (lokaler Pfad), "supabase" (Supabase userfile ID), oder "url" (HTTP/HTTPS URL)',
          enum: ['filesystem', 'supabase', 'url'],
        },
        path: {
          type: 'string',
          description: 'Pfad, Supabase File-ID, oder URL je nach source',
        },
        caption: {
          type: 'string',
          description: 'Optionale Bildunterschrift/Beschreibung (max 1024 Zeichen)',
        },
        filename: {
          type: 'string',
          description: 'Optionaler Dateiname (default: wird aus path abgeleitet)',
        },
      },
      required: ['source', 'path'],
    },
    requiresConfirmation: false,
  },

  // Web Document Delivery Tool (CAIO agent)
  {
    name: 'deliver_document',
    description: 'Stelle ein Dokument/eine Datei im Web-UI zum Download bereit. Quellen: Dateisystem (path), Supabase Storage (fileId), oder URL. Die Datei wird in Supabase Storage hochgeladen und ist über einen Download-Link im Chat verfügbar.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Dateiquelle: "filesystem" (lokaler Pfad), "supabase" (Supabase userfile ID), oder "url" (HTTP/HTTPS URL)',
          enum: ['filesystem', 'supabase', 'url'],
        },
        path: {
          type: 'string',
          description: 'Pfad, Supabase File-ID, oder URL je nach source',
        },
        description: {
          type: 'string',
          description: 'Optionale Beschreibung des Dokuments',
        },
        filename: {
          type: 'string',
          description: 'Optionaler Dateiname (default: wird aus path abgeleitet)',
        },
      },
      required: ['source', 'path'],
    },
    requiresConfirmation: false,
  },
];
