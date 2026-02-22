import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import * as stateManager from './stateManager.js';
import {
  formatContextBlock,
  getCombinedSystemContextBlock,
  getSystemContextProfile,
} from './systemContext.js';

describe('systemContext provenance tags', () => {
  const originalProvenanceFlag = config.contextProvenanceTags;

  afterEach(() => {
    config.contextProvenanceTags = originalProvenanceFlag;
    stateManager.clearAllStates();
  });

  it('formats a compact provenance header with context kind', () => {
    const block = formatContextBlock(
      {
        kind: 'workspace_policy',
        source: '/opt/Klyde/projects/Devai/workspace/AGENTS.md',
        priority: 'high',
        freshness: 'cached',
        sensitivity: 'medium',
      },
      '## Workspace Instructions\nUse AGENTS.md rules first.',
    );

    expect(block).toContain('kind="workspace_policy"');
    expect(block).toContain('source="/opt/Klyde/projects/Devai/workspace/AGENTS.md"');
    expect(block).toContain('tokens_est=');
    expect(block).toContain('## Workspace Instructions');
  });

  it('injects provenance-tagged blocks and exposes a context profile', () => {
    config.contextProvenanceTags = true;
    const sessionId = 'system-context-test-1';
    stateManager.createState(sessionId);
    stateManager.setGatheredInfo(sessionId, 'devaiMdBlock', '## DevAI Instructions\nStay concise.');
    stateManager.setGatheredInfo(sessionId, 'devaiMdSourcePath', '/opt/Klyde/projects/Devai/devai.md');

    const combined = getCombinedSystemContextBlock(sessionId);
    const profile = getSystemContextProfile(sessionId);
    const kinds = profile.entries.map((entry) => entry.kind);

    expect(combined).toContain('[CTX kind="devai_instructions"');
    expect(combined).toContain('[CTX kind="memory_behavior_policy"');
    expect(combined).toContain('## Memory-Verhalten');
    expect(profile.totalTokensEstimate).toBeGreaterThan(0);
    expect(kinds).toEqual(expect.arrayContaining(['devai_instructions', 'memory_behavior_policy']));
  });

  it('can disable provenance tags while keeping context content', () => {
    config.contextProvenanceTags = false;
    const sessionId = 'system-context-test-2';
    stateManager.createState(sessionId);
    stateManager.setGatheredInfo(sessionId, 'workspaceMdBlock', '## Workspace Instructions\nAlways follow workspace policy.');
    stateManager.setGatheredInfo(sessionId, 'workspaceMdSourcePaths', ['/opt/Klyde/projects/Devai/workspace/AGENTS.md']);
    stateManager.setGatheredInfo(
      sessionId,
      'workspaceMdDiagnostics',
      { workspaceRoot: '/opt/Klyde/projects/Devai/workspace', mode: 'main' },
    );

    const combined = getCombinedSystemContextBlock(sessionId);

    expect(combined).not.toContain('[CTX ');
    expect(combined).toContain('## Workspace Instructions');
    expect(combined).toContain('## Memory-Verhalten');
  });
});
