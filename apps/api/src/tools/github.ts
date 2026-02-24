import { config } from '../config.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import simpleGit from 'simple-git';

interface WorkflowConfig {
  stagingDeployWorkflow: string;
  testWorkflow: string;
}

async function loadWorkflowConfig(): Promise<WorkflowConfig> {
  try {
    const configPath = resolve(import.meta.dirname, '../../config/workflows.json');
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.warn('[github] Failed to load workflow config:', err instanceof Error ? err.message : err);
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

// ---------------------------------------------------------------------------
// Pull Request Creation
// ---------------------------------------------------------------------------

export interface CreatePRResult {
  success: boolean;
  prUrl: string;
  prNumber: number;
  branch: string;
  title: string;
  filesChanged: number;
}

/**
 * Create a GitHub PR from locally committed (but unpushed) changes.
 *
 * Flow:
 *   1. Detect unpushed commits on the current branch vs origin/dev
 *   2. Create an ephemeral branch via GitHub API
 *   3. Push changed files to that branch via GitHub API
 *   4. Open a PR from the ephemeral branch → dev
 */
export async function createPullRequest(
  title: string,
  description?: string,
  baseBranch: string = 'dev',
): Promise<CreatePRResult> {
  const { owner, repo } = getRepoInfo();
  const headers = getGitHubHeaders();

  // Find git root (same logic as git.ts)
  const allowedRoots = [...config.allowedRoots];
  let gitRoot: string | null = null;
  for (const root of allowedRoots) {
    const candidate = resolve(root);
    try {
      const git = simpleGit(candidate);
      const isRepo = await git.checkIsRepo();
      if (isRepo) {
        gitRoot = (await git.revparse(['--show-toplevel'])).trim();
        break;
      }
    } catch (err) { console.warn('[github] Failed to check git repo:', err instanceof Error ? err.message : err); }
  }
  if (!gitRoot) throw new Error('No git repository found in allowed roots');

  const git = simpleGit(gitRoot);

  // 1. Get the diff between local HEAD and origin/dev
  const diffSummary = await git.diffSummary([`origin/${baseBranch}...HEAD`]);
  if (diffSummary.files.length === 0) {
    throw new Error('No changes to create a PR from. Commit your changes first.');
  }

  // 2. Get base branch SHA from GitHub
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`,
    { headers },
  );
  if (!refRes.ok) throw new Error(`Failed to get base branch ref: ${refRes.status} ${await refRes.text()}`);
  const refData = await refRes.json() as { object: { sha: string } };
  const baseSha = refData.object.sha;

  // 3. Create ephemeral branch name
  const date = new Date().toISOString().slice(0, 10);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const branchName = `devo/${date}-${slug}`;

  // Create branch via GitHub API
  const createBranchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    },
  );
  if (!createBranchRes.ok) {
    throw new Error(`Failed to create branch: ${createBranchRes.status} ${await createBranchRes.text()}`);
  }

  // 4. Push each changed file to the new branch via GitHub Contents API
  //    We read the local file content and PUT it to GitHub
  let currentTreeSha = baseSha;
  for (const file of diffSummary.files) {
    const filePath = file.file;
    if (file.binary) continue; // skip binary files

    // Check if file was deleted
    const isDeleted = file.changes === 0 && file.insertions === 0 && file.deletions === 0;
    if (isDeleted) continue; // skip deleted files for now (PR will show the diff)

    try {
      const content = await readFile(resolve(gitRoot, filePath), 'utf-8');
      const base64Content = Buffer.from(content).toString('base64');

      // Get current file SHA on the branch (if it exists)
      let fileSha: string | undefined;
      try {
        const getFileRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branchName}`,
          { headers },
        );
        if (getFileRes.ok) {
          const fileData = await getFileRes.json() as { sha: string };
          fileSha = fileData.sha;
        }
      } catch (err) { console.warn('[github] File SHA lookup failed (may be new file):', err instanceof Error ? err.message : err); }

      const putBody: Record<string, unknown> = {
        message: `${title}: update ${filePath}`,
        content: base64Content,
        branch: branchName,
      };
      if (fileSha) putBody.sha = fileSha;

      const putRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(putBody),
        },
      );
      if (!putRes.ok) {
        const errText = await putRes.text();
        console.warn(`[github] Failed to push file ${filePath}: ${putRes.status} ${errText}`);
      }
    } catch (err) {
      console.warn(`[github] Could not read/push file ${filePath}:`, err);
    }
  }

  // 5. Create the PR
  const prBody = description || `Automated PR by DEVO.\n\nChanges:\n${diffSummary.files.map((f) => `- ${f.file}`).join('\n')}`;
  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body: prBody,
        head: branchName,
        base: baseBranch,
      }),
    },
  );

  if (!prRes.ok) {
    throw new Error(`Failed to create PR: ${prRes.status} ${await prRes.text()}`);
  }

  const prData = await prRes.json() as { html_url: string; number: number };

  return {
    success: true,
    prUrl: prData.html_url,
    prNumber: prData.number,
    branch: branchName,
    title,
    filesChanged: diffSummary.files.length,
  };
}
