import { describe, expect, it } from 'vitest';
import {
  LEGACY_TYPE_MAP,
  AGENT_STARTED,
  AGENT_THINKING,
  AGENT_SWITCHED,
  AGENT_DELEGATED,
  AGENT_COMPLETED,
  AGENT_FAILED,
  AGENT_HISTORY,
  TOOL_CALL_STARTED,
  TOOL_CALL_COMPLETED,
  TOOL_CALL_FAILED,
  TOOL_ACTION_PENDING,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_QUEUED,
  WF_TURN_STARTED,
  WF_COMPLETED,
  WF_FAILED,
} from './catalog.js';

describe('Event Catalog', () => {
  // ── AC-1: LEGACY_TYPE_MAP covers all legacy stream types ───────

  it('maps all legacy stream types to domain event types', () => {
    const expectedMappings: Record<string, string> = {
      agent_start: AGENT_STARTED,
      agent_thinking: AGENT_THINKING,
      agent_switch: AGENT_SWITCHED,
      delegation: AGENT_DELEGATED,
      agent_complete: AGENT_COMPLETED,
      agent_history: AGENT_HISTORY,
      error: AGENT_FAILED,
      tool_call: TOOL_CALL_STARTED,
      tool_result: TOOL_CALL_COMPLETED,
      action_pending: TOOL_ACTION_PENDING,
      user_question: GATE_QUESTION_QUEUED,
      approval_request: GATE_APPROVAL_QUEUED,
    };

    for (const [legacy, domain] of Object.entries(expectedMappings)) {
      expect(LEGACY_TYPE_MAP[legacy], `${legacy} should map to ${domain}`).toBe(domain);
    }
  });

  // ── AC-2: No mapping for 'response' (terminal events) ─────────

  it('does NOT map the legacy "response" type (handled by dispatcher)', () => {
    expect(LEGACY_TYPE_MAP['response']).toBeUndefined();
  });

  // ── AC-3: Event type naming convention ─────────────────────────

  it('follows domain.entity.verb_past naming convention', () => {
    const allTypes = [
      AGENT_STARTED, AGENT_THINKING, AGENT_SWITCHED, AGENT_DELEGATED,
      AGENT_COMPLETED, AGENT_FAILED, AGENT_HISTORY,
      TOOL_CALL_STARTED, TOOL_CALL_COMPLETED, TOOL_CALL_FAILED, TOOL_ACTION_PENDING,
      GATE_QUESTION_QUEUED, GATE_APPROVAL_QUEUED,
      WF_TURN_STARTED, WF_COMPLETED, WF_FAILED,
    ];

    for (const type of allTypes) {
      // Should contain at least one dot (domain.something)
      expect(type).toContain('.');
      // Should be lowercase with dots and underscores only
      expect(type).toMatch(/^[a-z._ ]+$/);
    }
  });

  // ── AC-4: All domain event constants are unique ────────────────

  it('has unique domain event type constants', () => {
    const allTypes = [
      AGENT_STARTED, AGENT_THINKING, AGENT_SWITCHED, AGENT_DELEGATED,
      AGENT_COMPLETED, AGENT_FAILED, AGENT_HISTORY,
      TOOL_CALL_STARTED, TOOL_CALL_COMPLETED, TOOL_CALL_FAILED, TOOL_ACTION_PENDING,
      GATE_QUESTION_QUEUED, GATE_APPROVAL_QUEUED,
      WF_TURN_STARTED, WF_COMPLETED, WF_FAILED,
    ];

    const unique = new Set(allTypes);
    expect(unique.size).toBe(allTypes.length);
  });
});
