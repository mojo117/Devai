import type { ToolEvent, StepperStep } from './types';

export interface MergedToolEvent extends ToolEvent {
  mergedCount?: number;
}

export function mergeConsecutiveThinking(events: ToolEvent[]): MergedToolEvent[] {
  const result: MergedToolEvent[] = [];

  for (const event of events) {
    const last = result[result.length - 1];

    if (
      event.type === 'thinking' &&
      last?.type === 'thinking' &&
      event.agent === last.agent
    ) {
      last.mergedCount = (last.mergedCount || 1) + 1;
      last.result = event.result; // Keep latest thinking text
    } else {
      result.push({ ...event });
    }
  }

  return result;
}

/* ── Tool label mapping ── */

const TOOL_LABELS: Record<string, { active: string; completed: (n: number) => string }> = {
  // ── File system ──
  fs_readFile:       { active: 'Reading...',           completed: (n) => n === 1 ? 'Read file'      : `Read ${n} files` },
  fs_writeFile:      { active: 'Writing...',           completed: (n) => n === 1 ? 'Wrote file'     : `Wrote ${n} files` },
  fs_edit:           { active: 'Editing...',           completed: (n) => n === 1 ? 'Edited file'    : `Edited ${n} files` },
  fs_delete:         { active: 'Deleting...',          completed: (n) => n === 1 ? 'Deleted file'   : `Deleted ${n} files` },
  fs_listFiles:      { active: 'Listing files...',     completed: () => 'Listed files' },
  fs_glob:           { active: 'Searching files...',   completed: () => 'Found files' },
  fs_grep:           { active: 'Searching code...',    completed: () => 'Searched code' },
  fs_mkdir:          { active: 'Creating folder...',   completed: () => 'Created folder' },
  fs_move:           { active: 'Moving...',            completed: (n) => n === 1 ? 'Moved file'    : `Moved ${n} files` },
  // ── Git ──
  git_status:        { active: 'Checking status...',   completed: () => 'Checked status' },
  git_diff:          { active: 'Diffing...',           completed: () => 'Diffed' },
  git_commit:        { active: 'Committing...',        completed: () => 'Committed' },
  git_push:          { active: 'Pushing...',           completed: () => 'Pushed' },
  git_pull:          { active: 'Pulling...',           completed: () => 'Pulled' },
  git_add:           { active: 'Staging...',           completed: () => 'Staged' },
  // ── DevOps ──
  bash_execute:      { active: 'Running command...',   completed: () => 'Ran command' },
  ssh_execute:       { active: 'Running SSH...',       completed: () => 'Ran SSH command' },
  npm_install:       { active: 'Installing...',        completed: () => 'Installed packages' },
  npm_run:           { active: 'Running script...',    completed: () => 'Ran script' },
  // ── PM2 ──
  pm2_status:        { active: 'Checking PM2...',      completed: () => 'Checked PM2' },
  pm2_restart:       { active: 'Restarting...',        completed: () => 'Restarted' },
  pm2_stop:          { active: 'Stopping...',          completed: () => 'Stopped' },
  pm2_start:         { active: 'Starting...',          completed: () => 'Started' },
  pm2_logs:          { active: 'Fetching logs...',     completed: () => 'Fetched logs' },
  pm2_reloadAll:     { active: 'Reloading all...',     completed: () => 'Reloaded all' },
  pm2_save:          { active: 'Saving PM2...',        completed: () => 'Saved PM2' },
  // ── GitHub ──
  github_triggerWorkflow:     { active: 'Triggering workflow...', completed: () => 'Triggered workflow' },
  github_getWorkflowRunStatus: { active: 'Checking workflow...',  completed: () => 'Checked workflow' },
  github_createPR:   { active: 'Creating PR...',       completed: () => 'Created PR' },
  // ── Supabase ──
  supabase_list_functions:   { active: 'Listing functions...',   completed: () => 'Listed functions' },
  supabase_get_function:     { active: 'Getting function...',    completed: () => 'Got function' },
  supabase_deploy_function:  { active: 'Deploying...',           completed: () => 'Deployed function' },
  supabase_delete_function:  { active: 'Deleting function...',   completed: () => 'Deleted function' },
  supabase_invoke_function:  { active: 'Invoking function...',   completed: () => 'Invoked function' },
  supabase_get_function_logs: { active: 'Fetching logs...',      completed: () => 'Fetched logs' },
  // ── Web / Search ──
  web_search:        { active: 'Searching web...',     completed: () => 'Searched web' },
  web_fetch:         { active: 'Fetching URL...',      completed: () => 'Fetched URL' },
  search_quick:      { active: 'Quick search...',      completed: () => 'Quick search done' },
  search_deep:       { active: 'Deep search...',       completed: () => 'Deep search done' },
  search_site_map:   { active: 'Mapping site...',      completed: () => 'Mapped site' },
  search_crawl:      { active: 'Crawling...',          completed: () => 'Crawled site' },
  search_extract:    { active: 'Extracting...',        completed: () => 'Extracted data' },
  search_research:   { active: 'Researching...',       completed: () => 'Research done' },
  // ── Communication ──
  send_email:        { active: 'Sending email...',     completed: () => 'Sent email' },
  notify_user:       { active: 'Notifying...',         completed: () => 'Notified' },
  // ── TaskForge ──
  taskforge_list_tasks:  { active: 'Listing tasks...',     completed: () => 'Listed tasks' },
  taskforge_get_task:    { active: 'Loading task...',      completed: () => 'Loaded task' },
  taskforge_create_task: { active: 'Creating task...',     completed: () => 'Created task' },
  taskforge_move_task:   { active: 'Moving task...',       completed: () => 'Moved task' },
  taskforge_add_comment: { active: 'Commenting...',        completed: () => 'Commented' },
  taskforge_search:      { active: 'Searching tasks...',   completed: () => 'Searched tasks' },
  // ── Memory ──
  memory_remember:   { active: 'Remembering...',       completed: () => 'Remembered' },
  memory_search:     { active: 'Searching memory...',  completed: () => 'Searched memory' },
  memory_readToday:  { active: 'Reading today...',     completed: () => 'Read today' },
  // ── Context ──
  context_readDocument:    { active: 'Reading doc...',      completed: () => 'Read document' },
  context_searchDocuments: { active: 'Searching docs...',   completed: () => 'Searched documents' },
  context_listDocuments:   { active: 'Listing docs...',     completed: () => 'Listed documents' },
  // ── Skills ──
  skill_create:      { active: 'Creating skill...',    completed: () => 'Created skill' },
  skill_update:      { active: 'Updating skill...',    completed: () => 'Updated skill' },
  skill_delete:      { active: 'Deleting skill...',    completed: () => 'Deleted skill' },
  skill_reload:      { active: 'Reloading skills...',  completed: () => 'Reloaded skills' },
  skill_list:        { active: 'Listing skills...',    completed: () => 'Listed skills' },
  // ── Scheduler ──
  scheduler_create:  { active: 'Creating schedule...', completed: () => 'Created schedule' },
  scheduler_list:    { active: 'Listing schedules...', completed: () => 'Listed schedules' },
  scheduler_update:  { active: 'Updating schedule...', completed: () => 'Updated schedule' },
  scheduler_delete:  { active: 'Deleting schedule...', completed: () => 'Deleted schedule' },
  reminder_create:   { active: 'Creating reminder...', completed: () => 'Created reminder' },
  // ── History ──
  history_search:       { active: 'Searching history...',  completed: () => 'Searched history' },
  history_listSessions: { active: 'Listing sessions...',   completed: () => 'Listed sessions' },
};

function getToolLabel(name: string, count: number, isActive: boolean): string {
  const entry = TOOL_LABELS[name];
  if (entry) return isActive ? entry.active : entry.completed(count);
  // Fallback: humanize the tool name
  const humanized = name.replace(/_/g, ' ');
  return isActive ? `${humanized}...` : humanized;
}

const FILE_TOOLS = new Set(['fs_readFile', 'fs_writeFile', 'fs_edit', 'fs_delete', 'fs_move']);

function extractToolDetail(events: ToolEvent[]): string {
  const name = events[0]?.name;
  if (!name) return '';

  const paths: string[] = [];
  for (const ev of events) {
    const args = ev.arguments as Record<string, unknown> | undefined;
    if (!args) continue;

    if (FILE_TOOLS.has(name)) {
      const p = (args.path ?? args.filePath ?? args.source) as string | undefined;
      if (typeof p === 'string') {
        paths.push(p.split('/').pop() || p);
      }
    } else if (name === 'fs_glob') {
      if (typeof args.pattern === 'string') return args.pattern;
    } else if (name === 'fs_grep') {
      if (typeof args.pattern === 'string') return `"${args.pattern}"`;
    } else if (name === 'fs_listFiles') {
      if (typeof args.path === 'string') return args.path.split('/').pop() || args.path;
    } else if (name === 'bash_execute') {
      if (typeof args.command === 'string') {
        return args.command.length > 60 ? args.command.slice(0, 57) + '...' : args.command;
      }
    } else if (name === 'ssh_execute') {
      if (typeof args.command === 'string') {
        return args.command.length > 60 ? args.command.slice(0, 57) + '...' : args.command;
      }
    } else if (name === 'web_search' || name === 'search_quick' || name === 'search_deep' || name === 'search_research') {
      if (typeof args.query === 'string') return args.query;
    } else if (name === 'web_fetch') {
      if (typeof args.url === 'string') {
        return args.url.length > 60 ? args.url.slice(0, 57) + '...' : args.url;
      }
    }
  }

  if (paths.length === 0) return '';
  if (paths.length <= 2) return paths.join(', ');
  return `${paths[0]}, ${paths[1]}, +${paths.length - 2} more`;
}

function computeDuration(events: ToolEvent[]): number | undefined {
  const starts = events.map((e) => e.createdAt).filter((t): t is number => t != null);
  const ends = events.map((e) => e.completedAt ?? e.createdAt).filter((t): t is number => t != null);
  if (starts.length === 0 || ends.length === 0) return undefined;
  return Math.max(...ends) - Math.min(...starts);
}

/* ── Skip sets ── */

const SPECIAL_TOOLS = new Set(['capture_visual_proof', 'skill_capture-visual-proof', 'deliver_document']);
const NOISY_STATUS = new Set(['parallel_loop', 'mode']);

/* ── Main grouping function ── */

export function groupToolEvents(events: ToolEvent[], live: boolean): StepperStep[] {
  const steps: StepperStep[] = [];
  let i = 0;

  while (i < events.length) {
    const event = events[i];

    // Skip special events (rendered separately in MessageList)
    if (event.name && SPECIAL_TOOLS.has(event.name)) { i++; continue; }

    // Skip decision_path events
    if (event.type === 'tool_result' && event.name === 'decision_path') { i++; continue; }

    // Skip noisy status events
    if (event.type === 'status' && event.name && NOISY_STATUS.has(event.name)) { i++; continue; }

    // ── Thinking: merge consecutive ──
    if (event.type === 'thinking') {
      const group: ToolEvent[] = [event];
      let j = i + 1;
      while (j < events.length && events[j].type === 'thinking' && events[j].agent === event.agent) {
        group.push(events[j]);
        j++;
      }
      const last = group[group.length - 1];
      const isActive = live && j === events.length;
      steps.push({
        id: event.id,
        type: 'thinking',
        label: isActive ? 'Reasoning...' : 'Reasoned',
        status: isActive ? 'active' : 'completed',
        thinkingText: typeof last.result === 'string' ? last.result : '',
        duration: computeDuration(group),
        events: group,
      });
      i = j;
      continue;
    }

    // ── Status events ──
    if (event.type === 'status') {
      steps.push({
        id: event.id,
        type: 'status',
        label: typeof event.result === 'string' ? event.result : 'Status',
        status: 'completed',
        events: [event],
      });
      i++;
      continue;
    }

    // ── Tool events: group consecutive same-name ──
    if (event.type === 'tool_call' || event.type === 'tool_result') {
      const toolName = event.name || 'unknown';
      const group: ToolEvent[] = [event];
      let j = i + 1;
      while (
        j < events.length &&
        (events[j].type === 'tool_call' || events[j].type === 'tool_result') &&
        events[j].name === toolName
      ) {
        group.push(events[j]);
        j++;
      }
      const allCompleted = group.every((e) => e.completed === true);
      const isActive = live && !allCompleted;
      const count = group.length;
      steps.push({
        id: event.id,
        type: 'tool_group',
        label: getToolLabel(toolName, count, isActive),
        activeLabel: getToolLabel(toolName, count, true),
        toolName,
        status: isActive ? 'active' : 'completed',
        count,
        duration: computeDuration(group),
        detail: extractToolDetail(group),
        events: group,
      });
      i = j;
      continue;
    }

    // Fallback — skip unknown
    i++;
  }

  return steps;
}
