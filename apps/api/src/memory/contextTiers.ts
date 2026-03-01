/**
 * Tiered Context Manager — 3-tier hierarchical context for long sessions.
 *
 * HOT:    Last N messages, full fidelity (recent context)
 * WARM:   LLM-summarized blocks (recent history)
 * COLD:   Bullet-point overview (background context)
 * PINNED: Original request + user decisions (never compacted)
 */

import type { LLMMessage, LLMProvider } from '../llm/types.js'
import { getTextContent } from '../llm/types.js'
import { llmRouter } from '../llm/router.js'

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessageTokens(msg: LLMMessage): number {
  return estimateTokens(getTextContent(msg.content))
}

interface TierBudgets {
  hot: number
  warm: number
  cold: number
}

const DEFAULT_BUDGETS: TierBudgets = {
  hot: 80_000,
  warm: 20_000,
  cold: 5_000,
}

const HOT_MIN_KEPT = 10

const WARM_SUMMARY_PROMPT = `Summarize these conversation messages concisely. Preserve:
- Tool execution results (what was done, what was found)
- Decisions made and their reasoning
- Error messages and how they were resolved
- File paths and code snippets that are still relevant

Be concise but don't lose important details. Use bullet points.`

const COLD_SUMMARY_PROMPT = `Condense these conversation summaries into a very brief overview (max 10 bullet points). Focus only on:
- What the user originally asked
- What major actions were taken
- Current state / what's left to do`

export class TieredContextManager {
  private cold = ''
  private warm: string[] = []
  private hot: LLMMessage[] = []
  private budgets: TierBudgets
  private pinnedRequest = ''
  private compacting = false

  constructor(budgets?: Partial<TierBudgets>) {
    this.budgets = { ...DEFAULT_BUDGETS, ...budgets }
  }

  setPinnedRequest(text: string): void {
    this.pinnedRequest = text
  }

  addMessage(msg: LLMMessage): void {
    this.hot.push(msg)
  }

  getHotMessages(): LLMMessage[] {
    return [...this.hot]
  }

  /**
   * Build the full message array for the LLM, with all tiers assembled.
   */
  buildMessages(): LLMMessage[] {
    const messages: LLMMessage[] = []

    // 1. Cold tier (oldest context, brief)
    if (this.cold) {
      messages.push({
        role: 'system',
        content: `[Session History — Overview]\n${this.cold}`,
      })
    }

    // 2. Warm tier (summarized recent history)
    if (this.warm.length > 0) {
      messages.push({
        role: 'system',
        content: `[Recent Context — Summarized]\n${this.warm.join('\n\n---\n\n')}`,
      })
    }

    // 3. Pinned request
    if (this.pinnedRequest) {
      messages.push({
        role: 'system',
        content: `[ORIGINAL REQUEST — pinned]\n${this.pinnedRequest}`,
      })
    }

    // 4. Hot tier (full fidelity recent messages)
    messages.push(...this.hot)

    return messages
  }

  getTokenUsage(): number {
    let total = 0
    total += estimateTokens(this.cold)
    for (const w of this.warm) total += estimateTokens(w)
    total += estimateTokens(this.pinnedRequest)
    for (const h of this.hot) total += estimateMessageTokens(h)
    return total
  }

  /**
   * Check if compaction is needed and execute it.
   * Call this before each LLM call.
   */
  async checkAndCompact(provider?: LLMProvider): Promise<void> {
    if (this.compacting) return
    this.compacting = true
    try {
      const hotTokens = this.hot.reduce((sum, m) => sum + estimateMessageTokens(m), 0)

      // HOT -> WARM: when hot exceeds budget
      if (hotTokens > this.budgets.hot && this.hot.length > HOT_MIN_KEPT) {
        await this.compactHotToWarm(provider)
      }

      // WARM -> COLD: when warm exceeds budget
      const warmTokens = this.warm.reduce((sum, s) => sum + estimateTokens(s), 0)
      if (warmTokens > this.budgets.warm) {
        await this.compactWarmToCold(provider)
      }
    } finally {
      this.compacting = false
    }
  }

  private async compactHotToWarm(provider?: LLMProvider): Promise<void> {
    const moveCount = this.hot.length - HOT_MIN_KEPT
    if (moveCount < 2) return

    const toCompact = this.hot.splice(0, moveCount)

    const transcript = toCompact
      .map((m) => `[${m.role}]: ${getTextContent(m.content)}`)
      .join('\n\n')

    try {
      const response = await llmRouter.generateWithFallback(
        provider ?? 'zai',
        {
          model: 'glm-4.7-flash',
          messages: [{ role: 'user', content: transcript }],
          systemPrompt: WARM_SUMMARY_PROMPT,
          maxTokens: 2048,
        },
      )
      this.warm.push(response.content)
      console.log(`[context-tiers] HOT->WARM: ${moveCount} messages -> ${estimateTokens(response.content)} tokens`)
    } catch (err) {
      // Compaction failed — push messages back to hot
      this.hot.unshift(...toCompact)
      console.error('[context-tiers] HOT->WARM compaction failed:', err)
    }
  }

  private async compactWarmToCold(provider?: LLMProvider): Promise<void> {
    const savedWarm = [...this.warm]
    const allWarm = this.warm.join('\n\n')

    try {
      const response = await llmRouter.generateWithFallback(
        provider ?? 'zai',
        {
          model: 'glm-4.7-flash',
          messages: [
            {
              role: 'user',
              content: `${this.cold ? `Previous overview:\n${this.cold}\n\n` : ''}New summaries:\n${allWarm}`,
            },
          ],
          systemPrompt: COLD_SUMMARY_PROMPT,
          maxTokens: 1024,
        },
      )
      this.cold = response.content
      this.warm = []
      console.log(`[context-tiers] WARM->COLD: ${estimateTokens(allWarm)} -> ${estimateTokens(this.cold)} tokens`)
    } catch (err) {
      this.warm = savedWarm
      console.error('[context-tiers] WARM->COLD compaction failed:', err)
    }
  }

  clear(): void {
    this.hot = []
    this.warm = []
    this.cold = ''
    this.pinnedRequest = ''
  }
}
