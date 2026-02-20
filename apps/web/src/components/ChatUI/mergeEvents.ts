import type { ToolEvent } from './types';

export interface MergedToolEvent extends ToolEvent {
  mergedCount?: number;
}

export function mergeConsecutiveThinking(events: ToolEvent[]): MergedToolEvent[] {
  const result: MergedToolEvent[] = [];

  for (const event of events) {
    const last = result[result.length - 1];

    if (
      event.type === 'thinking' &&
      last?.type === 'thinking' &&
      event.agent === last.agent
    ) {
      last.mergedCount = (last.mergedCount || 1) + 1;
      last.result = event.result; // Keep latest thinking text
    } else {
      result.push({ ...event });
    }
  }

  return result;
}
