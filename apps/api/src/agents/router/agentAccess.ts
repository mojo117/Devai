import type { AgentDefinition, AgentName } from '../types.js';
import { toolRegistry } from '../../tools/registry.js';
import { mcpManager } from '../../mcp/index.js';

// Agent definitions
import { CHAPO_AGENT } from '../chapo.js';
import { DEVO_AGENT } from '../devo.js';
import { SCOUT_AGENT } from '../scout.js';
import { CAIO_AGENT } from '../caio.js';

const AGENTS: Record<AgentName, AgentDefinition> = {
  chapo: CHAPO_AGENT,
  devo: DEVO_AGENT,
  scout: SCOUT_AGENT,
  caio: CAIO_AGENT,
};

// Get agent definition
export function getAgent(name: AgentName): AgentDefinition {
  return AGENTS[name];
}

// Get tools for a specific agent (native + MCP + meta — via unified registry)
export function getToolsForAgent(agent: AgentName): string[] {
  // Primary source: unified registry (includes native + meta tools registered at module load)
  const registryTools = toolRegistry.getAgentTools(agent);

  // Also include MCP tools (registered at runtime, may not be in agent access yet)
  const mcpTools = mcpManager.getToolsForAgent(agent);
  const combined = new Set([...registryTools, ...mcpTools]);
  return Array.from(combined);
}

// Check if an agent can use a specific tool
export function canAgentUseTool(agent: AgentName, toolName: string): boolean {
  // Check unified registry first, then fall back to MCP manager
  return toolRegistry.canAccess(agent, toolName) ||
    mcpManager.getToolsForAgent(agent).includes(toolName);
}
