import * as fsTools from './fs.js';
import * as gitTools from './git.js';
import * as githubTools from './github.js';
import * as logsTools from './logs.js';
import * as bashTools from './bash.js';
import * as execSessionTools from './execSession.js';
import * as sshTools from './ssh.js';
import * as pm2Tools from './pm2.js';
import * as webTools from './web.js';
import * as firecrawlTools from './firecrawl.js';
import * as contextTools from './context.js';
import * as memoryTools from './memory.js';
import * as historyTools from './history.js';
import * as schedulerTools from './scheduler.js';
import * as taskforgeTools from './taskforge.js';
import * as emailTools from './email.js';
import * as telegramTools from './telegram.js';
import * as contextApi from './context.js';
import * as supabaseEdgeTools from './supabaseEdgeFunctions.js';
import { skillCreate, skillUpdate, skillDelete, skillReload, skillList } from './skillHandlers.js';
import { searchUserfiles } from '../services/userfileService.js';

export type ToolArgs = Record<string, unknown>;

export interface ToolExecutionContext {
  fsOptions?: import('./fs.js').FsOptions;
  pickContextRoot: () => Promise<string>;
}

export type ToolHandler = (args: ToolArgs, context: ToolExecutionContext) => Promise<unknown>;

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  fs_listFiles: async (args, context) => fsTools.listFiles(args.path as string, context.fsOptions),
  fs_readFile: async (args, context) => fsTools.readFile(args.path as string, context.fsOptions),
  fs_writeFile: async (args) => fsTools.writeFile(args.path as string, args.content as string),
  fs_glob: async (args, context) => fsTools.globFiles(
    args.pattern as string,
    args.path as string | undefined,
    undefined,
    context.fsOptions,
  ),
  fs_grep: async (args, context) => fsTools.grepFiles(
    args.pattern as string,
    args.path as string,
    args.glob as string | undefined,
    undefined,
    context.fsOptions,
  ),
  fs_edit: async (args) => fsTools.editFile(
    args.path as string,
    args.old_string as string,
    args.new_string as string,
    args.replace_all as boolean | undefined,
  ),
  fs_mkdir: async (args) => fsTools.makeDirectory(args.path as string),
  fs_move: async (args) => fsTools.moveFile(args.source as string, args.destination as string),
  fs_delete: async (args) => fsTools.deleteFile(args.path as string, args.recursive as boolean | undefined),

  git_status: async () => gitTools.gitStatus(),
  git_diff: async (args) => gitTools.gitDiff(args.staged as boolean | undefined),
  git_commit: async (args) => gitTools.gitCommit(args.message as string),
  git_push: async (args) => gitTools.gitPush(args.remote as string | undefined, args.branch as string | undefined),
  git_pull: async (args) => gitTools.gitPull(args.remote as string | undefined, args.branch as string | undefined),
  git_add: async (args) => gitTools.gitAdd(args.files as string[] | undefined),

  github_triggerWorkflow: async (args) => githubTools.triggerWorkflow(
    args.workflow as string,
    args.ref as string,
    args.inputs as Record<string, string> | undefined,
  ),
  github_getWorkflowRunStatus: async (args) => githubTools.getWorkflowRunStatus(args.runId as number),
  github_createPR: async (args) => githubTools.createPullRequest(
    args.title as string,
    args.description as string | undefined,
    args.baseBranch as string | undefined,
  ),

  logs_getStagingLogs: async (args) => logsTools.getStagingLogs(args.lines as number | undefined),

  web_search: async (args) => {
    const result = await webTools.webSearch(args.query as string, {
      complexity: args.complexity as 'simple' | 'detailed' | 'deep' | undefined,
      recency: args.recency as 'day' | 'week' | 'month' | 'year' | undefined,
    });
    return webTools.formatWebSearchResult(result);
  },
  web_fetch: async (args) => webTools.webFetch(args.url as string, {
    timeout: args.timeout as number | undefined,
  }),
  search_quick: async (args) => firecrawlTools.scoutSearchFast(args.query as string, {
    limit: args.limit as number | undefined,
    country: args.country as string | undefined,
    location: args.location as string | undefined,
    categories: args.categories as Array<'research' | 'github' | 'pdf'> | undefined,
    sources: args.sources as Array<'web' | 'news'> | undefined,
  }),
  search_deep: async (args) => firecrawlTools.scoutSearchDeep(args.query as string, {
    limit: args.limit as number | undefined,
    country: args.country as string | undefined,
    location: args.location as string | undefined,
    categories: args.categories as Array<'research' | 'github' | 'pdf'> | undefined,
    sources: args.sources as Array<'web' | 'news'> | undefined,
    recency: args.recency as 'day' | 'week' | 'month' | 'year' | undefined,
  }),
  search_site_map: async (args) => firecrawlTools.scoutSiteMap(args.url as string, {
    search: args.search as string | undefined,
    limit: args.limit as number | undefined,
    includeSubdomains: args.includeSubdomains as boolean | undefined,
    ignoreSitemap: args.ignoreSitemap as boolean | undefined,
    sitemapOnly: args.sitemapOnly as boolean | undefined,
  }),
  search_crawl: async (args) => firecrawlTools.scoutCrawlFocused(args.url as string, {
    prompt: args.prompt as string | undefined,
    includePaths: args.includePaths as string[] | undefined,
    excludePaths: args.excludePaths as string[] | undefined,
    maxPages: args.maxPages as number | undefined,
    maxDepth: args.maxDepth as number | undefined,
    includeSubdomains: args.includeSubdomains as boolean | undefined,
    allowExternalLinks: args.allowExternalLinks as boolean | undefined,
  }),
  search_extract: async (args) => firecrawlTools.scoutExtractSchema(args.urls as string[], {
    prompt: args.prompt as string | undefined,
    schema: args.schema as Record<string, unknown> | undefined,
    enableWebSearch: args.enableWebSearch as boolean | undefined,
  }),
  search_research: async (args) => firecrawlTools.scoutResearchBundle(args.query as string, {
    domains: args.domains as string[] | undefined,
    recencyDays: args.recencyDays as number | undefined,
    maxFindings: args.maxFindings as number | undefined,
  }),

  bash_execute: async (args) => bashTools.executeBash(args.command as string, {
    cwd: args.cwd as string | undefined,
    timeout: args.timeout as number | undefined,
  }),
  exec_session_start: async (args) => execSessionTools.devoExecSessionStart(args.command as string, {
    cwd: args.cwd as string | undefined,
    timeoutMs: args.timeoutMs as number | undefined,
    allowArbitraryInput: args.allowArbitraryInput as boolean | undefined,
  }),
  exec_session_write: async (args) => execSessionTools.devoExecSessionWrite(
    args.sessionId as string,
    args.input as string,
  ),
  exec_session_poll: async (args) => execSessionTools.devoExecSessionPoll(
    args.sessionId as string,
    {
      maxBytes: args.maxBytes as number | undefined,
    },
  ),
  ssh_execute: async (args) => sshTools.executeSSH(
    args.host as string,
    args.command as string,
    { timeout: args.timeout as number | undefined },
  ),
  pm2_status: async (args) => pm2Tools.pm2Status(args.host as string | undefined),
  pm2_restart: async (args) => pm2Tools.pm2Restart(args.processName as string, args.host as string | undefined),
  pm2_stop: async (args) => pm2Tools.pm2Stop(args.processName as string, args.host as string | undefined),
  pm2_start: async (args) => pm2Tools.pm2Start(args.processName as string, args.host as string | undefined),
  pm2_logs: async (args) => pm2Tools.pm2Logs(
    args.processName as string,
    args.lines as number | undefined,
    args.host as string | undefined,
  ),
  pm2_reloadAll: async (args) => pm2Tools.pm2ReloadAll(args.host as string | undefined),
  pm2_save: async (args) => pm2Tools.pm2Save(args.host as string | undefined),
  npm_install: async (args) => bashTools.npmInstall(
    args.packageName as string | undefined,
    args.cwd as string | undefined,
  ),
  npm_run: async (args) => bashTools.npmRun(args.script as string, args.cwd as string | undefined),

  context_listDocuments: async (_args, context) => contextApi.listDocuments(await context.pickContextRoot()),
  context_readDocument: async (args, context) => contextApi.readDocument(
    await context.pickContextRoot(),
    args.path as string,
  ),
  context_searchDocuments: async (args, context) => contextApi.searchDocuments(
    await context.pickContextRoot(),
    args.query as string,
  ),

  memory_remember: async (args) => memoryTools.memoryRemember(args.content as string, {
    sessionId: args.sessionId as string | undefined,
    source: 'tool.memory_remember',
  }),
  memory_search: async (args) => memoryTools.memorySearch(args.query as string, {
    limit: args.limit as number | undefined,
  }),
  memory_readToday: async () => memoryTools.memoryReadToday(),

  history_search: async (args) => historyTools.historySearch({
    query: args.query as string,
    limit: args.limit as number | undefined,
    role: args.role as 'user' | 'assistant' | 'system' | undefined,
    sessionId: args.sessionId as string | undefined,
  }),
  history_listSessions: async (args) => historyTools.historyListSessions({
    limit: args.limit as number | undefined,
  }),

  scheduler_create: async (args) => schedulerTools.schedulerCreate(
    args.name as string,
    args.cronExpression as string,
    args.instruction as string,
    args.notificationChannel as string | undefined,
  ),
  scheduler_list: async () => schedulerTools.schedulerList(),
  scheduler_update: async (args) => schedulerTools.schedulerUpdate(
    args.id as string,
    {
      name: args.name as string | undefined,
      cronExpression: args.cronExpression as string | undefined,
      instruction: args.instruction as string | undefined,
      notificationChannel: args.notificationChannel as string | null | undefined,
      enabled: args.enabled as boolean | undefined,
    },
  ),
  scheduler_delete: async (args) => schedulerTools.schedulerDelete(args.id as string),
  reminder_create: async (args) => schedulerTools.reminderCreate(
    args.message as string,
    args.datetime as string,
    args.notificationChannel as string | undefined,
  ),
  notify_user: async (args) => schedulerTools.notifyUser(
    args.message as string,
    args.channel as string | undefined,
  ),

  taskforge_list_tasks: async (args) => taskforgeTools.taskforgeListTasks(
    args.project as string | undefined,
    args.status as string | undefined,
  ),
  taskforge_get_task: async (args) => taskforgeTools.taskforgeGetTask(
    args.taskId as string,
    args.project as string | undefined,
  ),
  taskforge_create_task: async (args) => taskforgeTools.taskforgeCreateTask(
    args.title as string,
    args.description as string,
    args.status as string | undefined,
    args.project as string | undefined,
  ),
  taskforge_move_task: async (args) => taskforgeTools.taskforgeMoveTask(
    args.taskId as string,
    args.newStatus as string,
    args.project as string | undefined,
  ),
  taskforge_add_comment: async (args) => taskforgeTools.taskforgeAddComment(
    args.taskId as string,
    args.comment as string,
    args.project as string | undefined,
  ),
  taskforge_search: async (args) => taskforgeTools.taskforgeSearch(
    args.query as string,
    args.project as string | undefined,
  ),

  send_email: async (args) => emailTools.sendEmail(
    args.to as string,
    args.subject as string,
    args.body as string,
    args.replyTo as string | undefined,
  ),
  telegram_send_document: async (args) => telegramTools.telegramSendDocument(
    args.source as 'filesystem' | 'supabase' | 'url',
    args.path as string,
    args.caption as string | undefined,
    args.filename as string | undefined,
  ),
  deliver_document: async (args) => telegramTools.deliverDocument(
    args.source as 'filesystem' | 'supabase' | 'url',
    args.path as string,
    args.description as string | undefined,
    args.filename as string | undefined,
  ),

  search_files: async (args) => {
    const result = await searchUserfiles(args.query as string | undefined);
    return result.result;
  },

  skill_create: async (args) => skillCreate(args),
  skill_update: async (args) => skillUpdate(args),
  skill_delete: async (args) => skillDelete(args),
  skill_reload: async () => skillReload(),
  skill_list: async () => skillList(),

  supabase_list_functions: async () => supabaseEdgeTools.listFunctions(),
  supabase_get_function: async (args) => supabaseEdgeTools.getFunction(args.functionName as string),
  supabase_deploy_function: async (args) => supabaseEdgeTools.deployFunction({
    functionName: args.functionName as string,
    files: args.files as { name: string; content: string }[],
    entrypointPath: args.entrypointPath as string | undefined,
    importMapPath: args.importMapPath as string | undefined,
    verifyJWT: args.verifyJWT as boolean | undefined,
  }),
  supabase_delete_function: async (args) => supabaseEdgeTools.deleteFunction(args.functionName as string),
  supabase_invoke_function: async (args) => supabaseEdgeTools.invokeFunction(
    args.functionName as string,
    args.payload as Record<string, unknown> | undefined,
    args.headers as Record<string, string> | undefined,
  ),
  supabase_get_function_logs: async (args) => supabaseEdgeTools.getFunctionLogs(
    args.functionName as string,
    args.limit as number | undefined,
  ),
};

export const READ_ONLY_TOOLS = new Set([
  'fs_listFiles',
  'fs_readFile',
  'fs_glob',
  'fs_grep',
  'git_status',
  'git_diff',
  'github_getWorkflowRunStatus',
  'logs_getStagingLogs',
  'pm2_status',
  'pm2_logs',
  'web_search',
  'web_fetch',
  'search_quick',
  'search_deep',
  'search_site_map',
  'search_crawl',
  'search_extract',
  'search_research',
  'context_listDocuments',
  'context_readDocument',
  'context_searchDocuments',
  'memory_search',
  'memory_readToday',
  'history_search',
  'history_listSessions',
  'scheduler_list',
  'search_files',
  'skill_list',
  'skill_reload',
]);
