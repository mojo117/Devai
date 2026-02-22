import type { AgentStreamEvent } from '../types.js';

export type SendEventFn = (event: AgentStreamEvent) => void;
