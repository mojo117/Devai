import type { ContextStats, SessionSummary } from '../../types';
import type { AgentName, AgentPhase } from '../AgentStatus';
import type { Artifact } from '../PreviewPanel/artifactParser';

export interface ToolEvent {
  id: string;
  type: 'status' | 'tool_call' | 'tool_result' | 'thinking';
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
  agent?: AgentName | string;
}

export interface ChatSessionState {
  sessionId: string | null;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  hasMessages: boolean;
}

export type ChatSessionCommand =
  | { type: 'select'; sessionId: string }
  | { type: 'new' }
  | { type: 'restart' };

export interface ChatSessionCommandEnvelope {
  nonce: number;
  command: ChatSessionCommand;
}

export interface ToolEventUpdate {
  type: ToolEvent['type'];
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
  chunk?: string;
  agent?: AgentName | string;
}

export interface ChatUIProps {
  projectRoot?: string | null;
  allowedRoots?: string[];
  ignorePatterns?: string[];
  onPinFile?: (file: string) => void;
  onContextUpdate?: (stats: ContextStats) => void;
  onLoadingChange?: (loading: boolean) => void;
  onAgentChange?: (agent: AgentName | null, phase: AgentPhase) => void;
  /** When true, session controls are expected to live in the global header. */
  showSessionControls?: boolean;
  sessionCommand?: ChatSessionCommandEnvelope | null;
  onSessionStateChange?: (state: ChatSessionState) => void;
  pinnedUserfileIds?: string[];
  onPinUserfile?: (id: string) => void;
  onClearPinnedUserfiles?: () => void;
  /** Toggle the preview pane on or off via /preview command. */
  onSetPreview?: (enabled: boolean) => void;
  /** Whether the preview pane is currently enabled. */
  previewEnabled?: boolean;
  /** Called when an artifact is detected in chat messages. */
  onArtifactDetected?: (artifact: Artifact | null) => void;
}
