export type ToolName =
  | 'fs.listFiles'
  | 'fs.readFile'
  | 'fs.writeFile'
  | 'git.status'
  | 'git.diff'
  | 'git.commit'
  | 'github.triggerWorkflow'
  | 'github.getWorkflowRunStatus'
  | 'logs.getStagingLogs'
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
