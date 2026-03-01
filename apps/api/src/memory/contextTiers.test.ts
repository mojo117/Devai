import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../llm/router.js', () => ({
  llmRouter: {
    generateWithFallback: vi.fn(),
  },
}))

import { TieredContextManager } from './contextTiers.js'
import { llmRouter } from '../llm/router.js'

describe('TieredContextManager', () => {
  let manager: TieredContextManager

  beforeEach(() => {
    vi.clearAllMocks()
    // Use very small budgets for testing
    manager = new TieredContextManager({ hot: 500, warm: 200, cold: 100 })
  })

  it('keeps messages in hot tier by default', () => {
    manager.addMessage({ role: 'user', content: 'hello' })
    manager.addMessage({ role: 'assistant', content: 'hi' })

    const messages = manager.buildMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('hello')
  })

  it('includes pinned request in build output', () => {
    manager.setPinnedRequest('Build a REST API')
    manager.addMessage({ role: 'user', content: 'hello' })

    const messages = manager.buildMessages()
    const pinned = messages.find((m) => typeof m.content === 'string' && m.content.includes('[ORIGINAL REQUEST'))
    expect(pinned).toBeDefined()
    expect(pinned!.content).toContain('Build a REST API')
  })

  it('reports token usage across all tiers', () => {
    manager.addMessage({ role: 'user', content: 'a'.repeat(400) })
    const usage = manager.getTokenUsage()
    expect(usage).toBeGreaterThan(90) // 400 chars / 4 = 100 tokens
  })

  it('compacts hot to warm when budget exceeded', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'Summary of old messages.',
      finishReason: 'stop',
      usedProvider: 'zai',
    })

    // Add enough messages to exceed hot budget (500 tokens = 2000 chars)
    for (let i = 0; i < 15; i++) {
      manager.addMessage({ role: 'user', content: `Message ${i}: ${'x'.repeat(200)}` })
    }

    await manager.checkAndCompact()

    // After compaction, hot should have fewer messages
    const hotMessages = manager.getHotMessages()
    expect(hotMessages.length).toBeLessThan(15)

    // Build should include warm tier summary
    const allMessages = manager.buildMessages()
    const warmMsg = allMessages.find((m) => typeof m.content === 'string' && m.content.includes('[Recent Context'))
    expect(warmMsg).toBeDefined()
  })

  it('compacts warm to cold when warm budget exceeded', async () => {
    // First mock for HOT->WARM, second for WARM->COLD
    vi.mocked(llmRouter.generateWithFallback)
      .mockResolvedValueOnce({
        content: 'x'.repeat(900), // Warm summary exceeds warm budget of 200
        finishReason: 'stop',
        usedProvider: 'zai',
      })
      .mockResolvedValueOnce({
        content: 'Cold overview.',
        finishReason: 'stop',
        usedProvider: 'zai',
      })

    for (let i = 0; i < 15; i++) {
      manager.addMessage({ role: 'user', content: `Message ${i}: ${'x'.repeat(200)}` })
    }

    await manager.checkAndCompact()

    const allMessages = manager.buildMessages()
    const coldMsg = allMessages.find((m) => typeof m.content === 'string' && m.content.includes('[Session History'))
    expect(coldMsg).toBeDefined()
    expect(coldMsg!.content).toContain('Cold overview.')
  })

  it('falls back gracefully when compaction LLM call fails', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockRejectedValueOnce(new Error('LLM down'))

    for (let i = 0; i < 15; i++) {
      manager.addMessage({ role: 'user', content: `Message ${i}: ${'x'.repeat(200)}` })
    }

    await manager.checkAndCompact()

    // Messages should be preserved (compaction failed gracefully)
    const hotMessages = manager.getHotMessages()
    expect(hotMessages.length).toBe(15)
  })

  it('builds messages in correct order: COLD -> WARM -> PINNED -> HOT', async () => {
    // Manually set up all tiers by running compaction
    vi.mocked(llmRouter.generateWithFallback)
      .mockResolvedValueOnce({
        content: 'Warm summary block',
        finishReason: 'stop',
        usedProvider: 'zai',
      })

    manager.setPinnedRequest('Build the feature')

    // Fill hot to trigger compaction
    for (let i = 0; i < 15; i++) {
      manager.addMessage({ role: 'user', content: `Msg ${i}: ${'y'.repeat(200)}` })
    }
    await manager.checkAndCompact()

    // Add a fresh hot message
    manager.addMessage({ role: 'user', content: 'latest message' })

    const messages = manager.buildMessages()

    // Find index positions
    const warmIdx = messages.findIndex((m) => typeof m.content === 'string' && m.content.includes('[Recent Context'))
    const pinnedIdx = messages.findIndex((m) => typeof m.content === 'string' && m.content.includes('[ORIGINAL REQUEST'))
    const hotIdx = messages.findIndex((m) => m.content === 'latest message')

    expect(warmIdx).toBeGreaterThanOrEqual(0)
    expect(pinnedIdx).toBeGreaterThan(warmIdx)
    expect(hotIdx).toBeGreaterThan(pinnedIdx)
  })

  it('clear() resets all tiers', () => {
    manager.addMessage({ role: 'user', content: 'hello' })
    manager.setPinnedRequest('test')
    manager.clear()

    expect(manager.buildMessages()).toHaveLength(0)
    expect(manager.getTokenUsage()).toBe(0)
  })
})
