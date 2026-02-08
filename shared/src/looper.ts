// ──────────────────────────────────────────────
// Looper-AI  –  Shared Type Definitions
// ──────────────────────────────────────────────

/** The classification the decision engine assigns to every incoming event. */
export type LooperIntent =
  | 'tool_call'     // An agent / tool must be invoked
  | 'clarify'       // More information from the user is needed
  | 'answer'        // Enough context – respond directly
  | 'self_validate' // Internal check before delivering the answer
  | 'continue';     // The loop should keep running (e.g. after a tool result)

/** Categories of specialised agents the looper can delegate to. */
export type AgentType =
  | 'developer'
  | 'searcher'
  | 'document_manager'
  | 'commander';

/** Every piece of information flowing through the loop is an event. */
export interface LooperEvent {
  id: string;
  type: LooperEventType;
  payload: unknown;
  timestamp: string;
  /** Optional – which agent produced this event. */
  sourceAgent?: AgentType;
}

export type LooperEventType =
  | 'user_message'
  | 'tool_result'
  | 'agent_result'
  | 'error'
  | 'clarification_response'
  | 'self_validation'
  | 'system';

/** A single step recorded inside the loop for observability. */
export interface LooperStep {
  stepIndex: number;
  intent: LooperIntent;
  agent?: AgentType;
  toolName?: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  error?: string;
  timestamp: string;
}

/** The result the decision engine returns after classifying an event. */
export interface DecisionResult {
  intent: LooperIntent;
  agent?: AgentType;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** If intent === 'clarify', this holds the question for the user. */
  clarificationQuestion?: string;
  /** If intent === 'answer', this holds the final answer text. */
  answerText?: string;
  /** Reasoning the decision engine used (for debugging / audit). */
  reasoning?: string;
}

/** Self-validation verdict. */
export interface ValidationResult {
  isComplete: boolean;
  confidence: number; // 0-1
  issues: string[];
  suggestion?: string;
}

/** Configuration knobs for the looper runtime. */
export interface LooperConfig {
  /** Maximum iterations before the loop force-stops. */
  maxIterations: number;
  /** Maximum token budget for the conversation window. */
  maxConversationTokens: number;
  /** Maximum retries per failed tool call. */
  maxToolRetries: number;
  /** Minimum confidence from self-validation to accept an answer. */
  minValidationConfidence: number;
  /** Whether self-validation is enabled. */
  selfValidationEnabled: boolean;
}

/** Status of an active loop run. */
export type LooperStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'error';

/** Streamed event sent to the client via NDJSON. */
export interface LooperStreamEvent {
  type: 'step' | 'thinking' | 'answer' | 'clarify' | 'error' | 'status' | 'tool_call' | 'tool_result' | 'validation';
  data: unknown;
  timestamp: string;
}

/** Request body for the /api/looper endpoint. */
export interface LooperRequest {
  message: string;
  provider: 'anthropic' | 'openai' | 'gemini';
  sessionId?: string;
  skillIds?: string[];
  config?: Partial<LooperConfig>;
}

/** Final response (also embedded in stream as last event). */
export interface LooperResponse {
  answer: string;
  steps: LooperStep[];
  sessionId: string;
  totalIterations: number;
  status: LooperStatus;
}
