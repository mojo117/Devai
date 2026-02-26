import { FastifyPluginAsync } from 'fastify';
import { collectSystemHealthSnapshot } from '../services/systemReliability.js';
import { getChapoLoopStats } from '../db/scheduledJobQueries.js';
import { getAgentExecutionStats, getAgentExecutionStatsBySession } from '../db/agentExecutionQueries.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_request, reply) => {
    try {
      const snapshot = await collectSystemHealthSnapshot();
      if (snapshot.status === 'degraded') {
        reply.code(503);
      }
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(503);
      return {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        error: message,
      };
    }
  });

  app.get('/health/stats/chapo-loops', async (request) => {
    const query = request.query as { since?: string };
    const sinceMinutes = parseInt(query.since || '90', 10);
    const stats = await getChapoLoopStats(sinceMinutes);
    
    const successes = stats.filter(s => s.phase === 'success');
    const failures = stats.filter(s => s.phase === 'failure');
    const avgDuration = successes.length > 0 
      ? Math.round(successes.reduce((sum, s) => sum + (s.duration_ms || 0), 0) / successes.length)
      : 0;
    const avgIterations = successes.length > 0
      ? Math.round(successes.reduce((sum, s) => sum + (s.iterations || 0), 0) / successes.length)
      : 0;
    const totalTokens = successes.reduce((sum, s) => sum + (s.tokens || 0), 0);
    
    return {
      summary: {
        total: stats.length,
        successes: successes.length,
        failures: failures.length,
        avgDurationMs: avgDuration,
        avgIterations,
        totalTokens,
      },
      runs: stats,
    };
  });

  app.get('/health/stats/agents', async (request) => {
    const query = request.query as { since?: string; session_id?: string };
    const sinceMinutes = parseInt(query.since || '90', 10);
    
    const stats = query.session_id 
      ? await getAgentExecutionStatsBySession(query.session_id)
      : await getAgentExecutionStats(sinceMinutes);
    
    const byAgent: Record<string, { total: number; successes: number; failures: number; escalated: number; avgDurationMs: number; totalTokens: number; totalTools: number }> = {};
    
    for (const run of stats) {
      if (!byAgent[run.agent]) {
        byAgent[run.agent] = { total: 0, successes: 0, failures: 0, escalated: 0, avgDurationMs: 0, totalTokens: 0, totalTools: 0 };
      }
      byAgent[run.agent].total++;
      if (run.phase === 'success') byAgent[run.agent].successes++;
      if (run.phase === 'failure') byAgent[run.agent].failures++;
      if (run.phase === 'escalated') byAgent[run.agent].escalated++;
      byAgent[run.agent].avgDurationMs += run.duration_ms || 0;
      byAgent[run.agent].totalTokens += run.tokens_used || 0;
      byAgent[run.agent].totalTools += run.tool_count || 0;
    }
    
    for (const agent of Object.keys(byAgent)) {
      const a = byAgent[agent];
      a.avgDurationMs = a.total > 0 ? Math.round(a.avgDurationMs / a.total) : 0;
    }
    
    return {
      summary: {
        total: stats.length,
        byAgent,
      },
      runs: stats,
    };
  });
};
