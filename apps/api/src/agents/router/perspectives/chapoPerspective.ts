import { llmRouter } from '../../../llm/router.js';
import { getCombinedSystemContextBlock } from '../../systemContext.js';
import type { ChapoPerspective, EffortEstimate, QualificationResult } from '../../types.js';
import { getAgent } from '../agentAccess.js';
import type { SendEventFn } from '../shared.js';
import { parseJsonObjectFromModelOutput } from '../planParsing.js';

/**
 * Get CHAPO's strategic perspective
 */
export async function getChapoPerspective(
  sessionId: string,
  userMessage: string,
  qualification: QualificationResult,
  sendEvent: SendEventFn,
): Promise<ChapoPerspective> {
  sendEvent({ type: 'perspective_start', agent: 'chapo' });
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Strategische Analyse...' });

  const chapo = getAgent('chapo');
  const systemContextBlock = getCombinedSystemContextBlock(sessionId);

  const systemPrompt = `${chapo.systemPrompt}
${systemContextBlock}

STRATEGISCHE ANALYSE FÜR PLAN MODE

Du analysierst als CHAPO (Task Coordinator) den Request aus strategischer Sicht.
Fokus auf:
- Koordinationsbedarf für DEVO
- Risikobewertung und Impact-Bereiche
- Abhängigkeiten und kritische Pfade

Kontext aus Qualifizierung:
- Task-Typ: ${qualification.taskType}
- Risiko: ${qualification.riskLevel}
- Komplexität: ${qualification.complexity}
- Reasoning: ${qualification.reasoning}

Antworte mit einem JSON-Block:
\`\`\`json
{
  "strategicAnalysis": "Beschreibung der strategischen Überlegungen",
  "riskAssessment": "low|medium|high",
  "impactAreas": ["Bereich 1", "Bereich 2"],
  "coordinationNeeds": ["Koordinationspunkt 1", "Koordinationspunkt 2"],
  "concerns": ["Bedenken 1", "Bedenken 2"],
  "recommendations": ["Empfehlung 1", "Empfehlung 2"],
  "estimatedEffort": "trivial|small|medium|large",
  "dependencies": ["Abhängigkeit 1"]
}
\`\`\``;

  const response = await llmRouter.generateWithFallback('zai', {
    model: chapo.model,
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt,
    toolsEnabled: false,
  });

  const parsed = parseJsonObjectFromModelOutput(response.content);

  const perspective: ChapoPerspective = {
    agent: 'chapo',
    analysis: (parsed.strategicAnalysis as string) || response.content,
    concerns: (parsed.concerns as string[]) || [],
    recommendations: (parsed.recommendations as string[]) || [],
    estimatedEffort: (parsed.estimatedEffort as EffortEstimate) || 'medium',
    dependencies: (parsed.dependencies as string[]) || [],
    timestamp: new Date().toISOString(),
    strategicAnalysis: (parsed.strategicAnalysis as string) || '',
    riskAssessment: (parsed.riskAssessment as 'low' | 'medium' | 'high') || qualification.riskLevel,
    impactAreas: (parsed.impactAreas as string[]) || [],
    coordinationNeeds: (parsed.coordinationNeeds as string[]) || [],
  };

  sendEvent({ type: 'perspective_complete', agent: 'chapo', perspective });
  return perspective;
}
