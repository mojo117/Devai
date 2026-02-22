import { describe, expect, it } from 'vitest';
import {
  classifyInboundText,
  detectYesNoDecision,
  isConversationalSmallTalk,
} from './intakeClassifier.js';

describe('intakeClassifier', () => {
  it('detects yes/no decisions', () => {
    expect(detectYesNoDecision('yes')).toBe(true);
    expect(detectYesNoDecision('Ja')).toBe(true);
    expect(detectYesNoDecision('nope')).toBe(false);
    expect(detectYesNoDecision('how are you')).toBeNull();
  });

  it('detects conversational smalltalk', () => {
    expect(isConversationalSmallTalk('How are you today?')).toBe(true);
    expect(isConversationalSmallTalk('Wie geht es dir?')).toBe(true);
    expect(isConversationalSmallTalk('Wie ist das Wetter heute?')).toBe(false);
  });

  it('maps pending approval yes/no to approval decision', () => {
    const result = classifyInboundText('yes', { hasPendingApprovals: true });
    expect(result.kind).toBe('approval_decision');
    expect(result.decision).toBe(true);
    expect(result.shouldCreateObligation).toBe(false);
  });

  it('requires explicit gate-answer markers for pending questions', () => {
    const result = classifyInboundText('Wie geht es dir?', { hasPendingQuestions: true });
    expect(result.kind).toBe('smalltalk');
    expect(result.shouldCreateObligation).toBe(false);
  });

  it('maps explicit answer prefix to question_answer', () => {
    const result = classifyInboundText('answer: continue with option A', { hasPendingQuestions: true });
    expect(result.kind).toBe('question_answer');
    expect(result.questionAnswer).toBe('continue with option A');
  });

  it('maps normal work requests to task_request', () => {
    const result = classifyInboundText('Please fix the failing test in scheduler route.');
    expect(result.kind).toBe('task_request');
    expect(result.shouldCreateObligation).toBe(true);
  });
});
