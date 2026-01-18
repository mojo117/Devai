import { config } from '../config.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

interface WorkflowConfig {
  stagingDeployWorkflow: string;
  testWorkflow: string;
}

async function loadWorkflowConfig(): Promise<WorkflowConfig> {
  try {
    const configPath = resolve(import.meta.dirname, '../../config/workflows.json');
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      stagingDeployWorkflow: 'deploy-staging.yml',
      testWorkflow: 'ci.yml',
    };
  }
}

function getGitHubHeaders(): Record<string, string> {
  if (!config.githubToken) {
    throw new Error('GITHUB_TOKEN is not configured');
  }
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${config.githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function getRepoInfo(): { owner: string; repo: string } {
  if (!config.githubOwner || !config.githubRepo) {
    throw new Error('GITHUB_OWNER and GITHUB_REPO must be configured');
  }
  return {
    owner: config.githubOwner,
    repo: config.githubRepo,
  };
}

export interface TriggerWorkflowResult {
  success: boolean;
  message: string;
  workflow: string;
  ref: string;
}

export async function triggerWorkflow(
  workflow: string,
  ref: string,
  inputs?: Record<string, string>
): Promise<TriggerWorkflowResult> {
  const { owner, repo } = getRepoInfo();
  const headers = getGitHubHeaders();

  // Resolve workflow name from config if using alias
  const workflowConfig = await loadWorkflowConfig();
  let workflowFile = workflow;

  if (workflow === 'staging' || workflow === 'deploy-staging') {
    workflowFile = workflowConfig.stagingDeployWorkflow;
  } else if (workflow === 'test' || workflow === 'tests') {
    workflowFile = workflowConfig.testWorkflow;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref,
      inputs: inputs || {},
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to trigger workflow: ${response.status} ${error}`);
  }

  return {
    success: true,
    message: `Workflow ${workflowFile} triggered on ref ${ref}`,
    workflow: workflowFile,
    ref,
  };
}

export interface WorkflowRunStatus {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  headSha: string;
}

export async function getWorkflowRunStatus(runId: number): Promise<WorkflowRunStatus> {
  const { owner, repo } = getRepoInfo();
  const headers = getGitHubHeaders();

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get workflow run: ${response.status} ${error}`);
  }

  const data = await response.json();

  return {
    id: data.id,
    name: data.name,
    status: data.status,
    conclusion: data.conclusion,
    url: data.html_url,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    headBranch: data.head_branch,
    headSha: data.head_sha,
  };
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
}

export async function listLatestRuns(workflow?: string, limit: number = 5): Promise<WorkflowRun[]> {
  const { owner, repo } = getRepoInfo();
  const headers = getGitHubHeaders();

  let url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=${limit}`;

  if (workflow) {
    const workflowConfig = await loadWorkflowConfig();
    let workflowFile = workflow;

    if (workflow === 'staging' || workflow === 'deploy-staging') {
      workflowFile = workflowConfig.stagingDeployWorkflow;
    } else if (workflow === 'test' || workflow === 'tests') {
      workflowFile = workflowConfig.testWorkflow;
    }

    url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs?per_page=${limit}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list workflow runs: ${response.status} ${error}`);
  }

  const data = await response.json();

  return data.workflow_runs.map((run: Record<string, unknown>) => ({
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
  }));
}
