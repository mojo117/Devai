/**
 * Tool RAG — Dynamic tool filtering by relevance.
 *
 * Instead of passing all ~80 tools on every LLM call, filter to
 * relevant categories based on the user's message and conversation context.
 * Falls back to full tool set when no specific categories match.
 */

import type { ToolDefinition as LLMToolDefinition } from '../llm/types.js';

/** Tool category groups — maps category name to tool names in that category */
const TOOL_CATEGORIES: Record<string, string[]> = {
  filesystem: [
    'fs_listFiles', 'fs_readFile', 'fs_writeFile', 'fs_glob', 'fs_grep',
    'fs_edit', 'fs_mkdir', 'fs_move', 'fs_delete',
  ],
  git: [
    'git_status', 'git_diff', 'git_commit', 'git_push', 'git_pull', 'git_add',
    'github_triggerWorkflow', 'github_getWorkflowRunStatus', 'github_createPR',
  ],
  devops: [
    'bash_execute', 'ssh_execute',
    'devo_exec_session_start', 'devo_exec_session_write', 'devo_exec_session_poll',
    'pm2_status', 'pm2_restart', 'pm2_stop', 'pm2_start', 'pm2_logs',
    'pm2_reloadAll', 'pm2_save', 'npm_install', 'npm_run',
    'logs_getStagingLogs',
  ],
  web: [
    'web_search', 'web_fetch',
    'scout_search_fast', 'scout_search_deep', 'scout_site_map',
    'scout_crawl_focused', 'scout_extract_schema', 'scout_research_bundle',
  ],
  context: [
    'context_listDocuments', 'context_readDocument', 'context_searchDocuments',
  ],
  memory: [
    'memory_remember', 'memory_search', 'memory_readToday',
    'history_search', 'history_listSessions',
  ],
  scheduler: [
    'scheduler_create', 'scheduler_list', 'scheduler_update', 'scheduler_delete',
    'reminder_create', 'notify_user',
  ],
  taskforge: [
    'taskforge_list_tasks', 'taskforge_get_task', 'taskforge_create_task',
    'taskforge_move_task', 'taskforge_add_comment', 'taskforge_search',
  ],
  communication: [
    'send_email', 'telegram_send_document', 'deliver_document',
  ],
  skills: [
    'skill_create', 'skill_update', 'skill_delete', 'skill_reload', 'skill_list',
  ],
};

/** Keyword patterns that trigger specific tool categories */
const CATEGORY_TRIGGERS: Record<string, RegExp> = {
  filesystem: /\b(file|read|write|edit|create|delet|director|folder|list|find|grep|search.{0,10}code|code.{0,10}search|path|inhalt|datei|ordner|lesen|schreiben)\b/i,
  git: /\b(git|commit|push|pull|branch|diff|status|pr|pull.?request|merge|github|workflow|deploy|version)\b/i,
  devops: /\b(bash|ssh|server|pm2|process|restart|npm|npx|install|run|build|execut|command|terminal|shell|clawd|klyde|log|staging|port|ts-node|node|python|script|ausführ|starte|führe)\b/i,
  web: /\b(search|web|url|fetch|crawl|scrap|brows|internet|google|documentation|docs|research|website|http|api|suche|recherche)\b/i,
  context: /\b(document|workspace|context|project.{0,5}file|kontext|dokument)\b/i,
  memory: /\b(remember|memory|recall|forget|history|session|previous|earlier|last.{0,5}time|erinner|merke|vergessen|verlauf)\b/i,
  scheduler: /\b(schedule|cron|remind|timer|recurring|job|alarm|notif|zeitplan|erinnerung|wecker)\b/i,
  taskforge: /\b(task|ticket|board|backlog|sprint|todo|kanban|aufgabe|status.{0,5}task|move.{0,5}task|taskforge)\b/i,
  communication: /\b(email|mail|telegram|send.{0,5}message|deliver|nachricht|senden)\b/i,
  skills: /\b(skill|command|slash|create.{0,5}skill|manage.{0,5}skill)\b/i,
};

/**
 * Meta-tools always included (agent control + user interaction).
 * These are essential for the loop to function regardless of task type.
 */
const ALWAYS_INCLUDED = new Set([
  'askUser', 'respondToUser', 'requestApproval',
  'chapo_plan_set', 'show_in_preview', 'search_files', 'todoWrite',
]);

/**
 * Filter tools to relevant categories based on the user's query.
 *
 * - Always includes meta-tools (askUser, respondToUser, etc.)
 * - Always includes filesystem tools (needed for nearly all tasks)
 * - Matches additional categories based on keyword triggers
 * - Falls back to ALL tools when no specific categories match (ambiguous query)
 */
export function filterToolsForQuery(
  allTools: LLMToolDefinition[],
  userMessage: string,
  conversationContext?: string,
): LLMToolDefinition[] {
  const text = `${userMessage} ${conversationContext || ''}`;

  const selectedNames = new Set<string>(ALWAYS_INCLUDED);

  // Filesystem is almost always needed
  for (const name of TOOL_CATEGORIES.filesystem) selectedNames.add(name);

  // Code blocks (backticks) imply bash/devops execution
  if (/`[^`]*\b(cd|npm|npx|node|python|sh|bash|curl|grep|cat|ls)\b[^`]*`/.test(text)) {
    for (const name of TOOL_CATEGORIES.devops) selectedNames.add(name)
  }

  // Match categories based on message content
  let matchedCategories = 0;
  for (const [category, trigger] of Object.entries(CATEGORY_TRIGGERS)) {
    if (category === 'filesystem') continue; // Already included
    if (trigger.test(text)) {
      for (const name of TOOL_CATEGORIES[category]) {
        selectedNames.add(name);
      }
      matchedCategories++;
    }
  }

  // If no specific categories matched → ambiguous request → pass all tools
  if (matchedCategories === 0) {
    return allTools;
  }

  const filtered = allTools.filter((t) => selectedNames.has(t.name));

  // Safety: if filtering removed too many tools (< 25), return all
  // This protects against edge cases where the heuristic is too aggressive
  if (filtered.length < 25 && allTools.length > 25) {
    return allTools;
  }

  return filtered;
}
