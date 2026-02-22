/**
 * Projection Registry — wires all projections to the shared event bus.
 *
 * Call registerProjections() once at startup (e.g. in server bootstrap).
 * Order matters: state → stream → external-output → markdown → audit.
 */

import { workflowBus } from '../events/bus.js';
import { StateProjection } from './stateProjection.js';
import { StreamProjection } from './streamProjection.js';
import { ExternalOutputProjection } from './externalOutputProjection.js';
import { MarkdownLogProjection } from './markdownLogProjection.js';
import { AuditProjection } from './auditProjection.js';

export function registerProjections(): void {
  workflowBus.register(new StateProjection());
  workflowBus.register(new StreamProjection());
  workflowBus.register(new ExternalOutputProjection());
  workflowBus.register(new MarkdownLogProjection());
  workflowBus.register(new AuditProjection());
}
