import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  findSimilarMemories: vi.fn(),
  insertMemory: vi.fn(),
  generateEmbedding: vi.fn(),
  getActiveTopics: vi.fn(),
  getSupabase: vi.fn(),
}))

vi.mock('./memoryStore.js', () => ({
  findSimilarMemories: mocks.findSimilarMemories,
  insertMemory: mocks.insertMemory,
}))

vi.mock('./embeddings.js', () => ({
  generateEmbedding: mocks.generateEmbedding,
}))

vi.mock('./recentFocus.js', () => ({
  getActiveTopics: mocks.getActiveTopics,
}))

vi.mock('../db/index.js', () => ({
  getSupabase: mocks.getSupabase,
}))

import {
  extractTurnEpisode,
  extractToolEpisode,
  promoteMaturedTopics,
  getMemoriesByTimeRange,
} from './episodicExtraction.js'

describe('extractTurnEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findSimilarMemories.mockResolvedValue([])
    mocks.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mocks.insertMemory.mockResolvedValue('new-id')
  })

  it('skips trivial turns (0 tools and short answer)', async () => {
    await extractTurnEpisode('sess-1', {
      userMessage: 'hi',
      assistantAnswer: 'hello',
      toolsUsed: [],
      iteration: 0,
    })
    expect(mocks.insertMemory).not.toHaveBeenCalled()
  })

  it('creates episodic memory for non-trivial turn', async () => {
    await extractTurnEpisode('sess-1', {
      userMessage: 'Fix the authentication bug in the login component',
      assistantAnswer: 'I found the issue in auth.ts and fixed the JWT validation. The token was expiring too early.',
      toolsUsed: ['fs_readFile', 'fs_writeFile', 'bash_execute'],
      iteration: 3,
    })
    expect(mocks.insertMemory).toHaveBeenCalledOnce()
    const insert = mocks.insertMemory.mock.calls[0][0]
    expect(insert.memory_type).toBe('episodic')
    expect(insert.namespace).toBe('devai/episodic/turn')
    expect(insert.source).toBe('episodic_turn')
    expect(insert.session_id).toBe('sess-1')
  })

  it('skips when near-duplicate exists (similarity > 0.9)', async () => {
    mocks.findSimilarMemories.mockResolvedValue([{ id: 'old', similarity: 0.95 }])
    await extractTurnEpisode('sess-1', {
      userMessage: 'Fix the auth bug',
      assistantAnswer: 'Fixed the JWT validation in auth.ts by increasing token TTL.',
      toolsUsed: ['fs_writeFile'],
      iteration: 2,
    })
    expect(mocks.insertMemory).not.toHaveBeenCalled()
  })

  it('includes tool names in content when tools were used', async () => {
    await extractTurnEpisode('sess-1', {
      userMessage: 'Deploy the app',
      assistantAnswer: 'Deployed successfully to dev branch.',
      toolsUsed: ['git_push', 'bash_execute'],
      iteration: 4,
    })
    const content = mocks.insertMemory.mock.calls[0][0].content
    expect(content).toContain('git_push')
  })
})

describe('extractToolEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findSimilarMemories.mockResolvedValue([])
    mocks.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mocks.insertMemory.mockResolvedValue('new-id')
  })

  it('skips non-significant tools (fs_readFile)', async () => {
    await extractToolEpisode('sess-1', {
      toolName: 'fs_readFile',
      toolArgs: { path: '/tmp/test.ts' },
      toolResult: 'file contents...',
    })
    expect(mocks.insertMemory).not.toHaveBeenCalled()
  })

  it('creates episodic for fs_writeFile with file path', async () => {
    await extractToolEpisode('sess-1', {
      toolName: 'fs_writeFile',
      toolArgs: { path: '/opt/Klyde/projects/Devai/apps/api/src/auth.ts' },
      toolResult: 'File written successfully',
    })
    expect(mocks.insertMemory).toHaveBeenCalledOnce()
    const insert = mocks.insertMemory.mock.calls[0][0]
    expect(insert.source).toBe('episodic_tool')
    expect(insert.content).toContain('auth.ts')
  })

  it('creates episodic for git_commit with message', async () => {
    await extractToolEpisode('sess-1', {
      toolName: 'git_commit',
      toolArgs: { message: 'fix: JWT token expiry' },
      toolResult: 'Committed abc1234',
    })
    const content = mocks.insertMemory.mock.calls[0][0].content
    expect(content).toContain('fix: JWT token expiry')
  })

  it('deduplicates against existing tool episodics', async () => {
    mocks.findSimilarMemories.mockResolvedValue([{ id: 'old', similarity: 0.95 }])
    await extractToolEpisode('sess-1', {
      toolName: 'git_commit',
      toolArgs: { message: 'fix: JWT token expiry' },
      toolResult: 'Committed abc1234',
    })
    expect(mocks.insertMemory).not.toHaveBeenCalled()
  })
})

describe('promoteMaturedTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findSimilarMemories.mockResolvedValue([])
    mocks.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mocks.insertMemory.mockResolvedValue('new-id')
  })

  it('skips topics below maturity threshold', async () => {
    mocks.getActiveTopics.mockResolvedValue([
      { topic: 'testing', touch_count: 2, session_count: 1, file_paths: [], strength: 0.5 },
    ])
    await promoteMaturedTopics('sess-1')
    expect(mocks.insertMemory).not.toHaveBeenCalled()
  })

  it('promotes topics meeting touch_count threshold (>= 5)', async () => {
    mocks.getActiveTopics.mockResolvedValue([
      { topic: 'memory/extraction', touch_count: 6, session_count: 1, file_paths: ['extraction.ts'], strength: 0.8 },
    ])
    await promoteMaturedTopics('sess-1')
    expect(mocks.insertMemory).toHaveBeenCalledOnce()
    const insert = mocks.insertMemory.mock.calls[0][0]
    expect(insert.namespace).toBe('devai/episodic/promoted')
    expect(insert.source).toBe('topic_promotion')
    expect(insert.content).toContain('memory/extraction')
  })

  it('promotes topics meeting session_count threshold (>= 2)', async () => {
    mocks.getActiveTopics.mockResolvedValue([
      { topic: 'devops/deployment', touch_count: 3, session_count: 3, file_paths: [], strength: 0.9 },
    ])
    await promoteMaturedTopics('sess-1')
    expect(mocks.insertMemory).toHaveBeenCalledOnce()
  })

  it('skips already-promoted topics (dedup)', async () => {
    mocks.getActiveTopics.mockResolvedValue([
      { topic: 'auth/jwt', touch_count: 10, session_count: 5, file_paths: [], strength: 1.0 },
    ])
    mocks.findSimilarMemories.mockResolvedValue([{ id: 'existing', similarity: 0.85 }])
    await promoteMaturedTopics('sess-1')
    expect(mocks.insertMemory).not.toHaveBeenCalled()
  })
})

describe('getMemoriesByTimeRange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns memories within range', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: [{ id: '1', content: 'test', memory_type: 'episodic' }],
      error: null,
    })
    mocks.getSupabase.mockReturnValue({ rpc: mockRpc })

    const result = await getMemoriesByTimeRange('2026-02-25', '2026-02-26')
    expect(result).toHaveLength(1)
    expect(mockRpc).toHaveBeenCalledWith('get_memories_by_timerange', {
      start_date: '2026-02-25',
      end_date: '2026-02-26',
      row_limit: 20,
    })
  })

  it('returns empty array on RPC error', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'RPC failed' },
    })
    mocks.getSupabase.mockReturnValue({ rpc: mockRpc })

    const result = await getMemoriesByTimeRange('2026-02-25', '2026-02-26')
    expect(result).toHaveLength(0)
  })
})
