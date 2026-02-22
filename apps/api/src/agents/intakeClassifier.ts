export type IntakeKind = 'approval_decision' | 'question_answer' | 'smalltalk' | 'task_request';

export interface IntakeClassification {
  kind: IntakeKind;
  shouldCreateObligation: boolean;
  reason: string;
  decision?: boolean;
  questionAnswer?: string;
}

interface IntakeClassificationOptions {
  hasPendingApprovals?: boolean;
  hasPendingQuestions?: boolean;
  latestPendingQuestion?: string;
}

export function normalizeIntakeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '');
}

export function detectYesNoDecision(text: string): boolean | null {
  const normalized = normalizeIntakeText(text);
  if (!normalized) return null;

  const yes = new Set([
    'y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'continue', 'proceed', 'go ahead',
    'ja', 'j', 'klar', 'weiter', 'mach weiter', 'bitte weiter',
  ]);
  const no = new Set([
    'n', 'no', 'nope', 'stop', 'cancel', 'abort',
    'nein', 'nee', 'stopp', 'abbrechen',
  ]);

  if (yes.has(normalized)) return true;
  if (no.has(normalized)) return false;
  return null;
}

export function isConversationalSmallTalk(text: string): boolean {
  const normalized = normalizeIntakeText(text);
  if (!normalized) return false;

  const directSmallTalk = new Set([
    'hi', 'hello', 'hey', 'yo', 'sup',
    'hallo', 'moin', 'servus',
    'ey', 'was geht', "what's up", 'whats up',
    'wie gehts', "wie geht's", 'wie geht es dir', 'wie geht es ihnen',
    'how are you', 'how are you today',
  ]);
  if (directSmallTalk.has(normalized)) return true;

  if (/^(how are you(?: today)?|wie geht(?:'s| es) (?:dir|ihnen))\b/.test(normalized)) {
    return true;
  }

  return false;
}

export function looksLikeContinueQuestion(question: string | undefined): boolean {
  const normalized = normalizeIntakeText(question || '');
  if (!normalized) return false;
  return normalized.includes('soll ich weitermachen')
    || normalized.includes('soll ich fortfahren')
    || normalized.includes('should i continue')
    || normalized.includes('continue?');
}

function extractExplicitQuestionAnswer(text: string): string | null {
  const patterns = [
    /^\s*\/answer(?:\s+|:\s*|-\s*)(.+)$/i,
    /^\s*(?:answer|antwort|reply)(?:\s+|:\s*|-\s*)(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const extracted = match[1].trim();
    if (extracted.length > 0) return extracted;
  }

  return null;
}

export function classifyInboundText(
  text: string,
  options: IntakeClassificationOptions = {},
): IntakeClassification {
  const hasPendingApprovals = Boolean(options.hasPendingApprovals);
  const hasPendingQuestions = Boolean(options.hasPendingQuestions);
  const decision = detectYesNoDecision(text);

  if (hasPendingApprovals && decision !== null) {
    return {
      kind: 'approval_decision',
      decision,
      shouldCreateObligation: false,
      reason: 'yes/no matched pending approval gate',
    };
  }

  const explicitQuestionAnswer = extractExplicitQuestionAnswer(text);
  if (hasPendingQuestions && explicitQuestionAnswer) {
    return {
      kind: 'question_answer',
      questionAnswer: explicitQuestionAnswer,
      shouldCreateObligation: false,
      reason: 'explicit gate-answer prefix detected',
    };
  }

  if (hasPendingQuestions && decision !== null && looksLikeContinueQuestion(options.latestPendingQuestion)) {
    return {
      kind: 'question_answer',
      questionAnswer: text.trim(),
      shouldCreateObligation: false,
      reason: 'yes/no mapped to continue-style pending question',
    };
  }

  if (isConversationalSmallTalk(text)) {
    return {
      kind: 'smalltalk',
      shouldCreateObligation: false,
      reason: 'small-talk intent',
    };
  }

  return {
    kind: 'task_request',
    shouldCreateObligation: true,
    reason: 'default work request',
  };
}
