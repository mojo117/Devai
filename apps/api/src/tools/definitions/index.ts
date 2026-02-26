import type { ToolDefinition } from '../registry.js';

import { fsTools } from './fsTools.js';
import { gitTools } from './gitTools.js';
import { devopsTools } from './devopsTools.js';
import { webTools } from './webTools.js';
import { contextTools } from './contextTools.js';
import { memoryTools } from './memoryTools.js';
import { historyTools } from './historyTools.js';
import { schedulerTools } from './schedulerTools.js';
import { communicationTools } from './communicationTools.js';
import { skillTools } from './skillTools.js';

export {
  fsTools,
  gitTools,
  devopsTools,
  webTools,
  contextTools,
  memoryTools,
  historyTools,
  schedulerTools,
  communicationTools,
  skillTools,
};

export const TOOL_REGISTRY: ToolDefinition[] = [
  ...fsTools,
  ...gitTools,
  ...devopsTools,
  ...webTools,
  ...contextTools,
  ...memoryTools,
  ...historyTools,
  ...schedulerTools,
  ...communicationTools,
  ...skillTools,
];
