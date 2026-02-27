import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryType } from './types.js';

// ---------------------------------------------------------------------------
// Mocks — hoisted so they resolve before module import
// ---------------------------------------------------------------------------

const mockSupabaseData = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    content: string;
    memory_type: MemoryType;
    namespace: string;
    strength: number;
    priority: string;
    is_valid: boolean;
  }>,
  error: null as { message: string } | null,
}));

const mockSelectChain = vi.hoisted(() => ({
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockSupabaseData.rows,
            error: mockSupabaseData.error,
          }),
        }),
      }),
    })),
  })),
}));

const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('fs/promises', async (importOriginal) => {
  const orig = await importOriginal<typeof import('fs/promises')>();
  return {
    ...orig,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
  };
});

vi.mock('./workspaceMemory.js', () => ({
  resolveWorkspaceRoot: vi.fn().mockResolvedValue('/mock/workspace'),
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import {
  CATEGORY_ORDER,
  mapNamespaceToCategory,
  renderMemoryMd,
  textOverlap,
  MAX_ENTRY_CHARS,
  MAX_TOTAL_CHARS,
} from './renderMemoryMd.js';

// ---------------------------------------------------------------------------
// Helper to build a mock memory row
// ---------------------------------------------------------------------------

function makeRow(
  id: string,
  content: string,
  opts: {
    namespace?: string;
    memory_type?: MemoryType;
    strength?: number;
    priority?: string;
  } = {},
) {
  return {
    id,
    content,
    memory_type: opts.memory_type ?? 'semantic',
    namespace: opts.namespace ?? 'devai/global',
    strength: opts.strength ?? 1,
    priority: opts.priority ?? 'high',
    is_valid: true,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('CATEGORY_ORDER', () => {
  it('contains exactly 5 categories in the correct order', () => {
    expect(CATEGORY_ORDER).toEqual([
      'User',
      'Projekte',
      'Workflows',
      'Termine & Events',
      'Erkenntnisse',
    ]);
    expect(CATEGORY_ORDER).toHaveLength(5);
  });
});

describe('mapNamespaceToCategory', () => {
  it('returns null for persona namespace (identity lives in SOUL.md)', () => {
    expect(mapNamespaceToCategory('persona', 'semantic')).toBeNull();
    expect(mapNamespaceToCategory('persona/role', 'semantic')).toBeNull();
    expect(mapNamespaceToCategory('persona/tone', 'episodic')).toBeNull();
    expect(mapNamespaceToCategory('PERSONA/Role', 'semantic')).toBeNull();
    expect(mapNamespaceToCategory('/persona/', 'semantic')).toBeNull();
  });

  it('maps devai/user and personal to User', () => {
    expect(mapNamespaceToCategory('devai/user', 'semantic')).toBe('User');
    expect(mapNamespaceToCategory('personal', 'semantic')).toBe('User');
    expect(mapNamespaceToCategory('DEVAI/USER', 'semantic')).toBe('User');
    expect(mapNamespaceToCategory('Personal', 'episodic')).toBe('User');
  });

  it('maps procedural memories to Workflows regardless of namespace', () => {
    expect(mapNamespaceToCategory('devai/global', 'procedural')).toBe('Workflows');
    expect(mapNamespaceToCategory('personal', 'procedural')).toBe('Workflows');
    expect(mapNamespaceToCategory('random/namespace', 'procedural')).toBe('Workflows');
    expect(mapNamespaceToCategory('devai/project/klyde', 'procedural')).toBe('Workflows');
    // Even persona namespace yields Workflows for procedural
    expect(mapNamespaceToCategory('persona/role', 'procedural')).toBe('Workflows');
  });

  it('maps project/global/architecture namespaces to Projekte', () => {
    expect(mapNamespaceToCategory('devai/project/klyde', 'semantic')).toBe('Projekte');
    expect(mapNamespaceToCategory('devai/project/clawd', 'episodic')).toBe('Projekte');
    expect(mapNamespaceToCategory('devai/global', 'semantic')).toBe('Projekte');
    expect(mapNamespaceToCategory('architecture', 'semantic')).toBe('Projekte');
    expect(mapNamespaceToCategory('ARCHITECTURE', 'semantic')).toBe('Projekte');
    expect(mapNamespaceToCategory('DevAI/Global', 'semantic')).toBe('Projekte');
  });

  it('maps devai/episodic/* with episodic type to Termine & Events', () => {
    expect(mapNamespaceToCategory('devai/episodic', 'episodic')).toBe('Termine & Events');
    expect(mapNamespaceToCategory('devai/episodic/meetings', 'episodic')).toBe('Termine & Events');
    expect(mapNamespaceToCategory('devai/episodic/deadlines', 'episodic')).toBe('Termine & Events');
    expect(mapNamespaceToCategory('DEVAI/EPISODIC/Events', 'episodic')).toBe('Termine & Events');
    expect(mapNamespaceToCategory('/devai//episodic/', 'episodic')).toBe('Termine & Events');
    // Non-episodic type in devai/episodic namespace falls through to Erkenntnisse
    expect(mapNamespaceToCategory('devai/episodic', 'semantic')).toBe('Erkenntnisse');
  });

  it('maps everything else to Erkenntnisse', () => {
    expect(mapNamespaceToCategory('devai/random', 'semantic')).toBe('Erkenntnisse');
    expect(mapNamespaceToCategory('unknown', 'semantic')).toBe('Erkenntnisse');
    expect(mapNamespaceToCategory('devai', 'episodic')).toBe('Erkenntnisse');
    expect(mapNamespaceToCategory('tools', 'semantic')).toBe('Erkenntnisse');
  });

  it('handles edge cases in namespace formatting', () => {
    expect(mapNamespaceToCategory('  devai/user  ', 'semantic')).toBe('User');
    expect(mapNamespaceToCategory('/devai//global/', 'semantic')).toBe('Projekte');
    expect(mapNamespaceToCategory('DEVAI/PROJECT/Test', 'semantic')).toBe('Projekte');
  });
});

describe('textOverlap', () => {
  it('returns 1 for identical strings', () => {
    expect(textOverlap('hello world', 'hello world')).toBe(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(textOverlap('', '')).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    expect(textOverlap('', 'hello')).toBe(0);
    expect(textOverlap('hello', '')).toBe(0);
  });

  it('returns high overlap for very similar strings', () => {
    const a = 'Jörn bevorzugt deutsche Antworten und arbeitet in CET';
    const b = 'Jörn bevorzugt deutsche Antworten und arbeitet in CEST';
    expect(textOverlap(a, b)).toBeGreaterThan(0.9);
  });

  it('returns low overlap for completely different strings', () => {
    const a = 'TypeScript React Frontend';
    const b = 'Python Django Backend';
    expect(textOverlap(a, b)).toBeLessThan(0.3);
  });

  it('is case-insensitive', () => {
    expect(textOverlap('Hello World', 'hello world')).toBe(1);
  });
});

describe('renderMemoryMd', () => {
  beforeEach(() => {
    mockSupabaseData.rows = [];
    mockSupabaseData.error = null;
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
  });

  it('writes an empty memory file when no valid memories exist', async () => {
    mockSupabaseData.rows = [];

    const result = await renderMemoryMd('/mock/workspace');

    expect(result).toBe('/mock/workspace/memory.md');
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toBe('# Memory\n');
  });

  it('writes an empty memory file when the query fails', async () => {
    mockSupabaseData.error = { message: 'connection refused' };

    const result = await renderMemoryMd('/mock/workspace');

    expect(result).toBe('/mock/workspace/memory.md');
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toBe('# Memory\n');
  });

  it('categorizes and renders memories correctly', async () => {
    mockSupabaseData.rows = [
      makeRow('1', 'Jörn, Deutsch, CET/CEST', { namespace: 'devai/user', strength: 1 }),
      makeRow('2', 'DevAI hat 41 Tasks', { namespace: 'devai/project/devai', strength: 0.9 }),
      makeRow('3', 'Scheduler: IMMER vor Senden pruefen', {
        namespace: 'devai/global',
        memory_type: 'procedural',
        strength: 0.8,
      }),
      makeRow('4', 'taskforge_list_tasks war truncated', {
        namespace: 'tools',
        strength: 0.7,
      }),
    ];

    const result = await renderMemoryMd('/mock/workspace');

    expect(result).toBe('/mock/workspace/memory.md');
    expect(mockWriteFile).toHaveBeenCalledOnce();

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('# Memory');
    expect(written).toContain('## User');
    expect(written).toContain('- Jörn, Deutsch, CET/CEST');
    expect(written).toContain('## Projekte');
    expect(written).toContain('- DevAI hat 41 Tasks');
    expect(written).toContain('## Workflows');
    expect(written).toContain('- Scheduler: IMMER vor Senden pruefen');
    expect(written).toContain('## Erkenntnisse');
    expect(written).toContain('- taskforge_list_tasks war truncated');
  });

  it('filters out persona memories', async () => {
    mockSupabaseData.rows = [
      makeRow('1', 'DevAI identity: helpful assistant', { namespace: 'persona/role', strength: 1 }),
      makeRow('2', 'Jörn is the admin', { namespace: 'devai/user', strength: 0.9 }),
    ];

    await renderMemoryMd('/mock/workspace');

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).not.toContain('DevAI identity');
    expect(written).toContain('Jörn is the admin');
  });

  it('deduplicates entries with >90% text overlap, keeping higher strength', async () => {
    mockSupabaseData.rows = [
      makeRow('1', 'Jörn bevorzugt deutsche Antworten und arbeitet in CET', {
        namespace: 'devai/user',
        strength: 1.0,
      }),
      makeRow('2', 'Jörn bevorzugt deutsche Antworten und arbeitet in CEST', {
        namespace: 'devai/user',
        strength: 0.5,
      }),
    ];

    await renderMemoryMd('/mock/workspace');

    const written = mockWriteFile.mock.calls[0][1] as string;
    // Should only contain the first (higher strength) version
    const userSection = written.split('## User')[1]?.split('##')[0] ?? '';
    const bulletLines = userSection.split('\n').filter((l) => l.startsWith('- '));
    expect(bulletLines).toHaveLength(1);
    expect(bulletLines[0]).toContain('CET');
  });

  it('truncates entries longer than MAX_ENTRY_CHARS', async () => {
    const longContent = 'A'.repeat(300);
    mockSupabaseData.rows = [
      makeRow('1', longContent, { namespace: 'devai/user', strength: 1 }),
    ];

    await renderMemoryMd('/mock/workspace');

    const written = mockWriteFile.mock.calls[0][1] as string;
    const bullet = written.split('- ')[1]?.split('\n')[0] ?? '';
    expect(bullet.length).toBeLessThanOrEqual(MAX_ENTRY_CHARS);
    expect(bullet).toContain('\u2026');
  });

  it('respects the total character budget', async () => {
    // Create many memories that would exceed MAX_TOTAL_CHARS
    const manyRows = Array.from({ length: 200 }, (_, i) =>
      makeRow(`id-${i}`, `Unique memory entry number ${i} with some extra padding text to take space`, {
        namespace: 'devai/global',
        strength: 1 - i * 0.001,
      }),
    );
    mockSupabaseData.rows = manyRows;

    await renderMemoryMd('/mock/workspace');

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written.length).toBeLessThanOrEqual(MAX_TOTAL_CHARS + 10); // small margin for trailing newline
  });

  it('renders episodic memories under Termine & Events', async () => {
    mockSupabaseData.rows = [
      makeRow('1', 'User info', { namespace: 'devai/user', strength: 1 }),
      makeRow('2', 'Meeting mit Jörn am Freitag', {
        namespace: 'devai/episodic/meetings',
        memory_type: 'episodic',
        strength: 0.9,
      }),
      makeRow('3', 'Deadline: DevAI v2 bis März', {
        namespace: 'devai/episodic/deadlines',
        memory_type: 'episodic',
        strength: 0.8,
      }),
    ];

    await renderMemoryMd('/mock/workspace');

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('## Termine & Events');
    expect(written).toContain('- Meeting mit Jörn am Freitag');
    expect(written).toContain('- Deadline: DevAI v2 bis März');
  });

  it('renders categories in CATEGORY_ORDER', async () => {
    mockSupabaseData.rows = [
      makeRow('4', 'An insight', { namespace: 'tools', strength: 0.5 }),
      makeRow('1', 'User info', { namespace: 'devai/user', strength: 1 }),
      makeRow('3', 'A workflow', { namespace: 'devai/global', memory_type: 'procedural', strength: 0.7 }),
      makeRow('2', 'A project note', { namespace: 'devai/project/x', strength: 0.9 }),
    ];

    await renderMemoryMd('/mock/workspace');

    const written = mockWriteFile.mock.calls[0][1] as string;
    const userIdx = written.indexOf('## User');
    const projectIdx = written.indexOf('## Projekte');
    const workflowIdx = written.indexOf('## Workflows');
    const insightIdx = written.indexOf('## Erkenntnisse');

    expect(userIdx).toBeGreaterThan(-1);
    expect(projectIdx).toBeGreaterThan(userIdx);
    expect(workflowIdx).toBeGreaterThan(projectIdx);
    expect(insightIdx).toBeGreaterThan(workflowIdx);
  });

  it('omits empty categories', async () => {
    mockSupabaseData.rows = [
      makeRow('1', 'User info', { namespace: 'devai/user', strength: 1 }),
    ];

    await renderMemoryMd('/mock/workspace');

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('## User');
    expect(written).not.toContain('## Projekte');
    expect(written).not.toContain('## Workflows');
    expect(written).not.toContain('## Termine & Events');
    expect(written).not.toContain('## Erkenntnisse');
  });

  it('ensures workspace directory exists before writing', async () => {
    mockSupabaseData.rows = [];

    await renderMemoryMd('/mock/workspace');

    expect(mockMkdir).toHaveBeenCalledWith('/mock/workspace', { recursive: true });
  });
});
