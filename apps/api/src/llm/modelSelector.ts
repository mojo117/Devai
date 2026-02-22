/**
 * Smart Model Selector
 *
 * Selects the appropriate LLM model based on task complexity.
 * Uses tiered approach: Fast (cheap) for simple tasks, Powerful (expensive) for complex.
 */

import type { TaskComplexityLevel, ModelSelection, ModelTier, LLMProviderName } from '../agents/types.js';
import { llmRouter } from './router.js';

// Model tiers by capability and cost
const MODEL_TIERS: Record<string, ModelTier[]> = {
  // Tier 1: Fast/Cheap - simple tasks, classification, routing
  fast: [
    { provider: 'zai', model: 'glm-4.7-flash' },                 // FREE
    { provider: 'gemini', model: 'gemini-2.0-flash' },
    { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
    { provider: 'openai', model: 'gpt-4o-mini' },
  ],
  // Tier 2: Balanced - most code tasks
  balanced: [
    { provider: 'zai', model: 'glm-5' },                          // $1.00/$3.20
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'gemini', model: 'gemini-1.5-pro' },
  ],
  // Tier 3: Powerful - complex reasoning, architecture
  powerful: [
    { provider: 'zai', model: 'glm-5' },                         // $1.00/$3.20
    { provider: 'anthropic', model: 'claude-opus-4-5-20251101' },
    { provider: 'anthropic', model: 'claude-opus-4-20250514' },
  ],
};

// Map task complexity to model tier
const COMPLEXITY_TO_TIER: Record<TaskComplexityLevel, string> = {
  trivial: 'fast',
  simple: 'fast',
  moderate: 'balanced',
  complex: 'powerful',
};

/**
 * Select the best model for a given task complexity
 */
export function selectModel(
  taskComplexity: TaskComplexityLevel,
  preferredProvider?: LLMProviderName
): ModelSelection {
  const tierName = COMPLEXITY_TO_TIER[taskComplexity];
  const tier = MODEL_TIERS[tierName];

  if (!tier || tier.length === 0) {
    throw new Error(`No models configured for tier: ${tierName}`);
  }

  // Prefer requested provider if available in tier
  if (preferredProvider) {
    const preferred = tier.find(m => m.provider === preferredProvider);
    if (preferred && llmRouter.isProviderConfigured(preferred.provider)) {
      return {
        ...preferred,
        reason: `${taskComplexity} task, preferred provider ${preferredProvider}`,
      };
    }
  }

  // Find first configured provider in tier
  for (const option of tier) {
    if (llmRouter.isProviderConfigured(option.provider)) {
      return {
        ...option,
        reason: `${taskComplexity} task, best available in ${tierName} tier`,
      };
    }
  }

  // Fallback: try any configured provider with any model
  const configuredProviders = llmRouter.getConfiguredProviders();
  if (configuredProviders.length > 0) {
    const fallbackProvider = configuredProviders[0];
    const models = llmRouter.listModels(fallbackProvider);
    return {
      provider: fallbackProvider as LLMProviderName,
      model: models[0] || 'claude-sonnet-4-20250514',
      reason: `Fallback: only ${fallbackProvider} configured`,
    };
  }

  throw new Error('No LLM provider configured');
}

/**
 * Classify task complexity from user message (early detection without LLM)
 *
 * This allows us to skip expensive qualification for trivial/simple tasks.
 */
export function classifyTaskComplexity(message: string): TaskComplexityLevel {
  const lowercased = message.toLowerCase().trim();

  // Simple general Q/A should not trigger the heavy multi-step qualification flow.
  // This avoids unnecessary clarifications and makes DevAI answer directly.
  //
  // Heuristic: short question-like input without code/devops keywords.
  const looksLikeGeneralQuestion =
    lowercased.length <= 140 &&
    (lowercased.endsWith('?') ||
      /^(do you|are you|can you|could you|would you|what is|what are|why|how|when|where|who)\b/.test(lowercased) ||
      /^(hast du|bist du|kannst du|koenntest du|wuerdest du|was ist|warum|wie|wann|wo|wer)\b/.test(lowercased)) &&
    !/\b(git|commit|push|pull|merge|branch|deploy|pm2|docker|kubernetes|ci|cd|npm|yarn|pnpm|install|build|test|logs?)\b/.test(lowercased) &&
    !/\b(file|files|folder|dir|directory|repo|repository|code|typescript|javascript|python|node|react|vite|next|api|endpoint|sql|database)\b/.test(lowercased);
  if (looksLikeGeneralQuestion) {
    return 'simple';
  }

  // Trivial: Simple reads, status checks, listings
  const trivialPatterns = [
    /^(show|list|display|print|cat|read)\b/,
    /^(what('?s| is| are)?( in| the)?)\b.*\b(files?|dir(ectory)?|folder|content)/,
    /^git\s+(status|log|branch)/,
    /^(check|get|view)\s+(status|logs?)/,
    /^ls\b/,
    /^(prüfe|zeig|liste|was liegt)/i,
  ];

  for (const pattern of trivialPatterns) {
    if (pattern.test(lowercased)) {
      return 'trivial';
    }
  }

  // Simple: Single file edits, simple searches, basic operations
  const simplePatterns = [
    /^(find|search|grep|look for)\b/,
    /^(edit|change|update|modify|fix)\s+(the\s+)?typo/,
    /^add\s+(a\s+)?(comment|log|console)/,
    /^(rename|move)\s+/,
    /^(finde|suche|ändere)\b/i,
  ];

  for (const pattern of simplePatterns) {
    if (pattern.test(lowercased)) {
      return 'simple';
    }
  }

  // Complex: Architecture, refactoring, multi-system changes
  const complexPatterns = [
    /refactor/i,
    /redesign/i,
    /architect/i,
    /migrate/i,
    /implement\s+(a\s+)?(new\s+)?(feature|system|module)/i,
    /create\s+(a\s+)?(new\s+)?(api|service|component|module)/i,
    /integrate/i,
    /optimize\s+(the\s+)?(entire|whole|all)/i,
    /rewrite/i,
    /umstrukturier/i,
  ];

  for (const pattern of complexPatterns) {
    if (pattern.test(lowercased)) {
      return 'complex';
    }
  }

  // Default to moderate for everything else
  return 'moderate';
}

/**
 * Check if a task should skip the qualification phase
 */
export function shouldSkipQualification(complexity: TaskComplexityLevel): boolean {
  return complexity === 'trivial' || complexity === 'simple';
}
