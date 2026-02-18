export type ToolName =
  | 'fs_listFiles'
  | 'fs_readFile'
  | 'fs_writeFile'
  | 'git_status'
  | 'git_diff'
  | 'git_commit'
  | 'github_triggerWorkflow'
  | 'github_getWorkflowRunStatus'
  | 'logs_getStagingLogs'
  | 'askForConfirmation';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: ToolParameters;
  requiresConfirmation: boolean;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  default?: unknown;
}

export interface ProjectContext {
  framework: 'vite' | 'cra' | 'next' | 'node' | 'unknown';
  language: 'typescript' | 'javascript';
  hasTests: boolean;
  testCommand?: string;
  buildCommand?: string;
  packageManager: 'npm' | 'yarn' | 'pnpm';
  summary: string;
}
