import { readFile, stat, access } from 'fs/promises';
import { resolve, join } from 'path';
import type { ProjectContext } from '@devai/shared';

interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  type?: string;
}

export async function scanProject(projectRoot: string): Promise<ProjectContext> {
  const packageJsonPath = resolve(projectRoot, 'package.json');

  let packageJson: PackageJson | null = null;
  try {
    const content = await readFile(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content);
  } catch {
    // No package.json
  }

  const framework = await detectFramework(projectRoot, packageJson);
  const language = await detectLanguage(projectRoot);
  const packageManager = await detectPackageManager(projectRoot);

  const hasTests = !!(packageJson?.scripts?.test);
  const testCommand = packageJson?.scripts?.test;
  const buildCommand = packageJson?.scripts?.build;

  const summary = generateSummary({
    name: packageJson?.name,
    framework,
    language,
    packageManager,
    hasTests,
    testCommand,
    buildCommand,
    scripts: packageJson?.scripts,
  });

  return {
    framework,
    language,
    hasTests,
    testCommand,
    buildCommand,
    packageManager,
    summary,
  };
}

async function detectFramework(
  projectRoot: string,
  packageJson: PackageJson | null
): Promise<ProjectContext['framework']> {
  const deps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  // Check for specific frameworks
  if (deps['next']) return 'next';
  if (deps['vite'] || await fileExists(resolve(projectRoot, 'vite.config.ts')) ||
      await fileExists(resolve(projectRoot, 'vite.config.js'))) {
    return 'vite';
  }
  if (deps['react-scripts'] || await fileExists(resolve(projectRoot, 'public/index.html'))) {
    return 'cra';
  }
  if (packageJson?.scripts?.start?.includes('node') || deps['express'] || deps['fastify']) {
    return 'node';
  }

  return 'unknown';
}

async function detectLanguage(projectRoot: string): Promise<ProjectContext['language']> {
  const tsconfigPath = resolve(projectRoot, 'tsconfig.json');
  if (await fileExists(tsconfigPath)) {
    return 'typescript';
  }
  return 'javascript';
}

async function detectPackageManager(projectRoot: string): Promise<ProjectContext['packageManager']> {
  if (await fileExists(resolve(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (await fileExists(resolve(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface SummaryInput {
  name?: string;
  framework: string;
  language: string;
  packageManager: string;
  hasTests: boolean;
  testCommand?: string;
  buildCommand?: string;
  scripts?: Record<string, string>;
}

function generateSummary(input: SummaryInput): string {
  const lines: string[] = [];

  lines.push(`Project: ${input.name || 'Unknown'}`);
  lines.push(`Framework: ${input.framework}`);
  lines.push(`Language: ${input.language}`);
  lines.push(`Package Manager: ${input.packageManager}`);

  if (input.hasTests && input.testCommand) {
    lines.push(`Test Command: ${input.testCommand}`);
  }

  if (input.buildCommand) {
    lines.push(`Build Command: ${input.buildCommand}`);
  }

  // Add available scripts
  if (input.scripts) {
    const availableScripts = Object.keys(input.scripts)
      .filter((s) => !['test', 'build'].includes(s))
      .slice(0, 5);

    if (availableScripts.length > 0) {
      lines.push(`Other Scripts: ${availableScripts.join(', ')}`);
    }
  }

  // Limit to ~20 lines
  return lines.slice(0, 20).join('\n');
}

// Cache for project context
let cachedContext: ProjectContext | null = null;
let cacheProjectRoot: string | null = null;

export async function getProjectContext(projectRoot: string): Promise<ProjectContext> {
  // Return cached context if available for the same project
  if (cachedContext && cacheProjectRoot === projectRoot) {
    return cachedContext;
  }

  cachedContext = await scanProject(projectRoot);
  cacheProjectRoot = projectRoot;

  return cachedContext;
}

// Clear the cache (useful when project changes)
export function clearProjectCache(): void {
  cachedContext = null;
  cacheProjectRoot = null;
}
