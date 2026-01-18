import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
loadEnv({ path: resolve(process.cwd(), '../../.env') });

export interface Config {
  nodeEnv: string;
  port: number;

  // LLM API Keys
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;

  // GitHub
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;

  // Project
  projectRoot?: string;
  allowedRoots: string[];
}

export function loadConfig(): Config {
  const allowedRoots = process.env.ALLOWED_ROOTS
    ? process.env.ALLOWED_ROOTS.split(/[;,]/).map((p) => p.trim()).filter(Boolean)
    : [];

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3001', 10),

    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,

    githubToken: process.env.GITHUB_TOKEN,
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,

    projectRoot: process.env.PROJECT_ROOT,
    allowedRoots,
  };
}

export const config = loadConfig();
