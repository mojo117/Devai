/**
 * Agent Router / Orchestrator
 *
 * Public facade for router modules.
 */

export type { SendEventFn } from './router/shared.js';

export {
  getAgent,
  getToolsForAgent,
  canAgentUseTool,
} from './router/agentAccess.js';

export {
  processRequest,
  handleUserResponse,
  handleUserApproval,
} from './router/requestFlow.js';

export { spawnScout } from './router/scoutRuntime.js';
export { spawnScout as delegateToScout } from './router/scoutRuntime.js';
