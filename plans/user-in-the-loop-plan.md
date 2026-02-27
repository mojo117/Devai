# User-in-the-Loop — Implementation Plan

> Clarifying questions when model is uncertain, not as default behavior.
> Hybrid with self-check: only ask when confidence is low or ambiguity is high.

---

## Problem

CHAPO sometimes produces answers that:
1. Address the wrong interpretation of an ambiguous request
2. Make assumptions the user didn't intend
3. Miss critical context that the user could easily provide

Current approach (external reflexion) adds latency and can confuse with vague feedback. We want a more natural approach where the model itself identifies when it needs more information.

---

## Design Principles

1. **Ask sparingly** — Most requests don't need clarification
2. **Ask specifically** — Questions should be actionable, not "what do you mean?"
3. **Make reasonable defaults** — When one interpretation is likely, use it and note the assumption
4. **Show uncertainty** — Users should know when model is unsure
5. **No friction for simple requests** — "What is 2+2?" should never ask for clarification

---

## Decision Framework

### When to Ask

```
ASK USER if:
├── Multiple valid interpretations exist AND no clear winner
│   Example: "Fix the bug" in a codebase with 50 bugs
│
├── Missing critical info that can't be obtained with tools
│   Example: "Add authentication" — what type? (JWT, OAuth, session?)
│
├── High risk of wrong action
│   Example: "Delete the database" — which one? are you sure?
│
└── Model confidence < 0.5 after self-check
```

### When NOT to Ask (Just Answer)

```
DON'T ASK if:
├── One interpretation is much more likely (>80%)
│   Action: Use it, note assumption at end of answer
│
├── Info can be obtained with tools (read file, grep, etc.)
│   Action: Get the info yourself
│
├── Request is simple/unambiguous
│   Example: "What does this function do?"
│
└── User is in flow state (rapid back-and-forth)
│   Action: Make reasonable choices, let user correct
```

---

## Architecture

### Flow Diagram

```
User message
    │
    ▼
CHAPO processes (normal loop with tools)
    │
    ▼
CHAPO generates answer + SELF-CHECK
    │
    ▼
Parse self-check result
    │
    ├── confidence >= 0.8 AND no critical uncertainties
    │       │
    │       ▼
    │   Return answer directly
    │
    ├── confidence 0.5-0.8 OR non-critical uncertainties
    │       │
    │       ▼
    │   Return answer + uncertainty note:
    │   "Answer: ... 
    │    (Note: I assumed X. Let me know if you meant Y.)"
    │
    └── confidence < 0.5 OR critical uncertainties
            │
            ▼
        Return clarifying question:
        "I need to clarify: [specific question]"
```

### Integration Point

Add self-check generation after CHAPO produces an answer (before or instead of current reflexion).

**Current flow (chapo-loop.ts:412-445):**
```typescript
if (!response.toolCalls || response.toolCalls.length === 0) {
  const answer = response.content || '';
  
  // Current: External reflexion
  if (this.iteration < 5 && !this.reflexionUsed && answer.length >= 200) {
    const review = await reviewAnswer(...);
    if (!review.approved) { /* retry with feedback */ }
  }
  
  return answer;
}
```

**New flow:**
```typescript
if (!response.toolCalls || response.toolCalls.length === 0) {
  let answer = response.content || '';
  
  // Parse embedded self-check
  const { finalAnswer, selfCheck } = parseSelfCheck(answer);
  
  if (selfCheck?.needsUserInput) {
    // Return clarifying question instead of answer
    return { answer: selfCheck.clarifyingQuestion, status: 'clarifying' };
  }
  
  if (selfCheck && selfCheck.confidence < 0.8) {
    // Append uncertainty note
    answer = finalAnswer + formatUncertaintyNote(selfCheck);
  }
  
  return { answer, status: 'completed', selfCheck };
}
```

---

## Prompt Design

### System Prompt Addition

Add to CHAPO's system prompt:

```markdown
## Self-Check Protocol

After generating your answer, briefly evaluate yourself. This helps catch issues early.

**After your answer**, include a self-check block:

---
SELF-CHECK:
confidence: <0.0-1.0>
assumptions:
- <assumption you made>
uncertainties:
- <what you couldn't verify>
---

**Confidence levels:**
- 0.9+: Very confident, answer is correct
- 0.7-0.9: Confident but made some assumptions
- 0.5-0.7: Uncertain about key parts
- <0.5: Should ask user for clarification

**When confidence < 0.5, replace your answer with a clarifying question:**

---
SELF-CHECK:
confidence: 0.3
needs_clarification: true
question: |
  I need more information to help effectively:
  1. <specific question 1>
  2. <specific question 2>
---

**Example outputs:**

Good (high confidence):
```
The issue is a missing dependency array in your useEffect hook.

---
SELF-CHECK:
confidence: 0.9
assumptions:
- You want the effect to run only on mount
uncertainties: []
---
```

Good (asks for clarification):
```
---
SELF-CHECK:
confidence: 0.3
needs_clarification: true
question: |
  I found multiple bugs that match "login issue":
  1. Session not persisting (auth.ts:45)
  2. OAuth callback missing (routes/auth.ts)
  
  Which one are you experiencing?
---
```
```

---

## Files to Create/Modify

### 1. NEW: `apps/api/src/agents/selfCheck.ts`

```typescript
export interface SelfCheckResult {
  confidence: number;
  assumptions: string[];
  uncertainties: string[];
  needsClarification: boolean;
  clarifyingQuestion?: string;
}

export interface ParsedResponse {
  answer: string;
  selfCheck: SelfCheckResult | null;
}

/**
 * Parse self-check block from model response.
 */
export function parseSelfCheck(response: string): ParsedResponse {
  // Check for self-check delimiter
  const delimiter = '---\nSELF-CHECK:';
  const delimiterIndex = response.indexOf(delimiter);
  
  if (delimiterIndex === -1) {
    return { answer: response, selfCheck: null };
  }
  
  const answer = response.slice(0, delimiterIndex).trim();
  const checkText = response.slice(delimiterIndex + delimiter.length);
  
  // Parse confidence
  const confidenceMatch = checkText.match(/confidence:\s*([\d.]+)/);
  const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;
  
  // Parse needs_clarification
  const needsClarification = /needs_clarification:\s*true/i.test(checkText);
  
  // Parse question (for clarification)
  const questionMatch = checkText.match(/question:\s*\|?\s*([\s\S]*?)(?=\n---|$)/);
  const clarifyingQuestion = questionMatch ? questionMatch[1].trim() : undefined;
  
  // Parse assumptions
  const assumptions = extractList(checkText, 'assumptions');
  
  // Parse uncertainties
  const uncertainties = extractList(checkText, 'uncertainties');
  
  return {
    answer,
    selfCheck: {
      confidence,
      assumptions,
      uncertainties,
      needsClarification: needsClarification || confidence < 0.5,
      clarifyingQuestion,
    }
  };
}

function extractList(text: string, field: string): string[] {
  const regex = new RegExp(`${field}:\\s*\\n([\\s\\S]*?)(?=\\n[a-z]+:|$)`, 'i');
  const match = text.match(regex);
  if (!match) return [];
  
  return match[1]
    .split('\n')
    .map(line => line.replace(/^-\s*/, '').trim())
    .filter(line => line.length > 0);
}

/**
 * Format uncertainty note to append to answer.
 */
export function formatUncertaintyNote(check: SelfCheckResult): string {
  if (check.confidence >= 0.8) return '';
  
  const parts: string[] = [];
  
  if (check.assumptions.length > 0) {
    parts.push(`Assumed: ${check.assumptions.join(', ')}`);
  }
  
  if (check.uncertainties.length > 0) {
    parts.push(`Uncertain about: ${check.uncertainties.join(', ')}`);
  }
  
  if (parts.length === 0) return '';
  
  return `\n\n_(${check.confidence * 100 | 0}% confident. ${parts.join('. ')})_`;
}
```

### 2. MODIFY: `apps/api/src/agents/chapo-loop.ts`

**Location:** Around line 412-445 (the ANSWER path)

```typescript
import { parseSelfCheck, formatUncertaintyNote } from './selfCheck.js';

// ... inside runLoop(), where answer is produced:

if (!response.toolCalls || response.toolCalls.length === 0) {
  let answer = response.content || '';
  
  // Parse self-check if present
  const { finalAnswer, selfCheck } = parseSelfCheck(answer);
  answer = finalAnswer;
  
  // Log self-check for debugging
  if (selfCheck) {
    console.log(`${trace}[chapo-loop] Self-check: confidence=${selfCheck.confidence}, needsClarification=${selfCheck.needsClarification}`);
  }
  
  // If model asks for clarification, return that instead
  if (selfCheck?.needsClarification && selfCheck.clarifyingQuestion) {
    return {
      answer: selfCheck.clarifyingQuestion,
      status: 'clarifying' as const,
      totalIterations: this.iteration + 1,
      selfCheck,
    };
  }
  
  // Append uncertainty note for medium-confidence answers
  if (selfCheck && selfCheck.confidence < 0.8) {
    answer = answer + formatUncertaintyNote(selfCheck);
  }
  
  return this.answerValidator.validateAndNormalize(
    userText, answer, this.iteration, this.emitDecisionPath.bind(this)
  );
}
```

### 3. MODIFY: `apps/api/src/agents/types.ts`

Add `selfCheck` to result type:

```typescript
export interface ChapoLoopResult {
  answer: string;
  status: 'completed' | 'aborted' | 'clarifying' | 'timeout';
  totalIterations: number;
  selfCheck?: SelfCheckResult;  // ADD THIS
}
```

### 4. MODIFY: CHAPO System Prompt

Add the self-check protocol to the system prompt (wherever that's defined — likely in agent definitions or a prompts file).

---

## Edge Cases

### 1. Model doesn't include self-check

**Handling:** If no `---\nSELF-CHECK:` found, treat as high confidence (0.8) and return answer normally.

### 2. Self-check parsing fails

**Handling:** Default to confidence 0.7, no assumptions/uncertainties. Log warning.

### 3. Model gives answer AND asks for clarification

**Handling:** If `needs_clarification: true`, ignore the answer and return only the question.

### 4. Multiple clarifying questions in a row

**Handling:** Track `clarifying` status. If user responds to clarification, continue normally. Don't ask more than 2 clarifying questions per turn.

### 5. Short answers (<200 chars)

**Handling:** Skip self-check parsing for very short answers (confirmations, status updates). They're unlikely to need clarification.

---

## Fallback Behavior

If self-check causes issues, we can:

1. **Disable per session:** Add flag to disable self-check
2. **Disable globally:** Environment variable `ENABLE_SELF_CHECK=false`
3. **Revert to external reflexion:** Keep current reflexion code as backup

---

## Verification

1. Send ambiguous request: "Fix the bug" in a project with multiple bugs
   - Expected: Model asks "which bug?"

2. Send specific request: "Fix the null pointer error in auth.ts line 45"
   - Expected: Model fixes it, includes self-check with high confidence

3. Send high-risk request: "Delete all test files"
   - Expected: Model asks for confirmation or lists what it would delete

4. Send simple request: "What is 2+2?"
   - Expected: Model answers directly, no self-check needed

---

## Migration Path

1. **Phase 1:** Add self-check prompt, but don't act on it (just log)
2. **Phase 2:** Enable uncertainty notes for medium-confidence
3. **Phase 3:** Enable clarifying questions for low-confidence
4. **Phase 4:** Remove external reflexion if self-check works well

---

## Summary

| File | Change |
|------|--------|
| `apps/api/src/agents/selfCheck.ts` | **NEW** — Parser and formatter |
| `apps/api/src/agents/chapo-loop.ts` | Modify — Parse self-check, handle clarification |
| `apps/api/src/agents/types.ts` | Modify — Add selfCheck to result |
| System prompt (wherever defined) | Modify — Add self-check protocol |

**Effort:** ~2 days
**Impact:** Reduces wrong answers, improves user trust through transparency
