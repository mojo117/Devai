import { describe, it, expect } from 'vitest'
import { buildIntakeSeedPrompt, parseIntakeSeedResponse } from './intakeSeed.js'

describe('intakeSeed', () => {
  describe('buildIntakeSeedPrompt', () => {
    it('builds prompt with user message embedded', () => {
      const prompt = buildIntakeSeedPrompt('Zeig mir die To-Do Liste und wie wird das Wetter')
      expect(prompt).toContain('Zeig mir die To-Do Liste und wie wird das Wetter')
      expect(prompt).toContain('JSON array')
    })
  })

  describe('parseIntakeSeedResponse', () => {
    it('parses valid JSON array', () => {
      const raw = '[{"content":"To-Do Liste anzeigen"},{"content":"Wetter morgen"}]'
      const result = parseIntakeSeedResponse(raw)
      expect(result).toEqual([
        { content: 'To-Do Liste anzeigen', status: 'pending' },
        { content: 'Wetter morgen', status: 'pending' },
      ])
    })

    it('returns empty array for invalid JSON', () => {
      expect(parseIntakeSeedResponse('not json')).toEqual([])
    })

    it('returns empty array for empty array response', () => {
      expect(parseIntakeSeedResponse('[]')).toEqual([])
    })

    it('handles JSON wrapped in markdown code block', () => {
      const raw = '```json\n[{"content":"Task 1"}]\n```'
      const result = parseIntakeSeedResponse(raw)
      expect(result).toEqual([{ content: 'Task 1', status: 'pending' }])
    })

    it('filters items with empty content', () => {
      const raw = '[{"content":"Real task"},{"content":""},{"content":"  "}]'
      const result = parseIntakeSeedResponse(raw)
      expect(result).toEqual([{ content: 'Real task', status: 'pending' }])
    })
  })
})
