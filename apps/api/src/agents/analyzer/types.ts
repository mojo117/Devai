// apps/api/src/agents/analyzer/types.ts
import { z } from 'zod';

/**
 * Capability flags - what the request needs
 */
export const CapabilityNeedsSchema = z.object({
  web_search: z.boolean().describe('Needs current info from web (weather, docs, news)'),
  code_read: z.boolean().describe('Needs to read/understand existing code'),
  code_write: z.boolean().describe('Needs to create or modify files'),
  devops: z.boolean().describe('Needs git, npm, pm2, deployment operations'),
  clarification: z.boolean().describe('Request is genuinely ambiguous, must ask user'),
});

export type CapabilityNeeds = z.infer<typeof CapabilityNeedsSchema>;

/**
 * Individual task in the breakdown
 */
export const TaskBreakdownSchema = z.object({
  description: z.string().describe('What this task does'),
  capability: z.enum(['web_search', 'code_read', 'code_write', 'devops']),
  depends_on: z.number().optional().describe('Index of task this depends on'),
});

export type TaskBreakdown = z.infer<typeof TaskBreakdownSchema>;

/**
 * Full capability analysis output
 */
export const CapabilityAnalysisSchema = z.object({
  needs: CapabilityNeedsSchema,
  tasks: z.array(TaskBreakdownSchema).min(1),
  question: z.string().optional().describe('Only if clarification needed'),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type CapabilityAnalysis = z.infer<typeof CapabilityAnalysisSchema>;

/**
 * Result from analyzer (includes raw response for debugging)
 */
export interface AnalyzerResult {
  analysis: CapabilityAnalysis;
  rawResponse: string;
  model: string;
  durationMs: number;
}
