import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';
import { upsertTopic, getActiveTopics, incrementSessionCount } from './recentFocus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagContext {
  userMessage: string;
  toolCalls: string[];
  assistantResponse: string;
  filePaths: string[];
}

interface TagResult {
  topic: string;
  file_paths: string[];
  directories: string[];
}

/** Debounce state per session — tracks last tag to avoid redundant writes. */
interface SessionTagState {
  lastTopic: string;
  lastFilePaths: string[];
  /** Topics already counted for incrementSessionCount this session. */
  seenTopics: Set<string>;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const sessionStates = new Map<string, SessionTagState>();

// ---------------------------------------------------------------------------
// Tagging prompt — kept minimal for low token cost
// ---------------------------------------------------------------------------

function buildSystemPrompt(existingTopics: string[]): string {
  const topicList = existingTopics.length > 0 ? existingTopics.join(', ') : '(none yet)';

  return `You are a topic tagger. Given a user message, tool calls, and an assistant response, identify the current work topic.

Return a JSON object:
{
  "topic": "short/topic-name",
  "file_paths": ["/path/to/file.ts"],
  "directories": ["/path/to/dir/"]
}

Rules:
- topic: short domain name, max 2 levels deep (e.g. "memory", "memory/extraction", "auth", "UI/sidebar")
- Use lowercase, separated by /
- Prefer reusing existing topics when they fit: ${topicList}
- Only propose sub-topic if work is clearly more specific than parent
- file_paths: actual file paths mentioned or accessed
- directories: parent directories of accessed files
- Return ONLY the JSON object`;
}

// ---------------------------------------------------------------------------
// Build user message for the tagger — keeps token budget small
// ---------------------------------------------------------------------------

function buildTagInput(context: TagContext): string {
  const userSnippet = context.userMessage.slice(0, 300);
  const assistantSnippet = context.assistantResponse.slice(0, 300);
  const tools = context.toolCalls.length > 0 ? context.toolCalls.join(', ') : 'none';
  const files = context.filePaths.length > 0 ? context.filePaths.join('\n') : 'none';

  return `User message: ${userSnippet}

Tool calls: ${tools}

File paths accessed:
${files}

Assistant response: ${assistantSnippet}`;
}

// ---------------------------------------------------------------------------
// Parse and validate the LLM response
// ---------------------------------------------------------------------------

function parseTagResponse(raw: string): TagResult | null {
  let jsonString = raw.trim();

  // Extract JSON from code blocks if present
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }

  const parsed: unknown = JSON.parse(jsonString);

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Validate topic
  if (typeof obj.topic !== 'string' || obj.topic.length === 0) {
    return null;
  }

  // Normalize topic: lowercase, trim, limit depth
  const topic = obj.topic
    .toLowerCase()
    .trim()
    .split('/')
    .slice(0, 2)
    .join('/');

  // Validate file_paths — must be an array of strings
  const filePaths: string[] = [];
  if (Array.isArray(obj.file_paths)) {
    for (const fp of obj.file_paths) {
      if (typeof fp === 'string' && fp.length > 0) {
        filePaths.push(fp);
      }
    }
  }

  // Validate directories — must be an array of strings
  const directories: string[] = [];
  if (Array.isArray(obj.directories)) {
    for (const dir of obj.directories) {
      if (typeof dir === 'string' && dir.length > 0) {
        directories.push(dir);
      }
    }
  }

  return { topic, file_paths: filePaths, directories };
}

// ---------------------------------------------------------------------------
// Debounce check — skip DB write if topic + file_paths are identical
// ---------------------------------------------------------------------------

function isDuplicate(sessionId: string, result: TagResult): boolean {
  const state = sessionStates.get(sessionId);
  if (!state) return false;

  if (state.lastTopic !== result.topic) return false;

  // Compare file_paths (order-independent)
  if (state.lastFilePaths.length !== result.file_paths.length) return false;

  const sortedPrev = [...state.lastFilePaths].sort();
  const sortedCurr = [...result.file_paths].sort();

  return sortedPrev.every((fp, i) => fp === sortedCurr[i]);
}

// ---------------------------------------------------------------------------
// Update debounce state
// ---------------------------------------------------------------------------

function updateSessionState(sessionId: string, result: TagResult): void {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = {
      lastTopic: '',
      lastFilePaths: [],
      seenTopics: new Set(),
    };
    sessionStates.set(sessionId, state);
  }

  state.lastTopic = result.topic;
  state.lastFilePaths = [...result.file_paths];
}

// ---------------------------------------------------------------------------
// Public API: tagCurrentWork — fire-and-forget topic tagging
// ---------------------------------------------------------------------------

export async function tagCurrentWork(
  sessionId: string,
  context: TagContext,
  provider: LLMProvider = 'zai',
): Promise<void> {
  try {
    // Fetch existing active topics for adaptive granularity
    const activeTopics = await getActiveTopics(20);
    const existingTopicNames = activeTopics.map((t) => t.topic);

    const systemPrompt = buildSystemPrompt(existingTopicNames);
    const userContent = buildTagInput(context);

    const response = await llmRouter.generateWithFallback(provider, {
      model: 'glm-4.7-flash',
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: userContent,
        },
      ],
      tools: [],
      toolsEnabled: false,
      maxTokens: 150,
    });

    const result = parseTagResponse(response.content);

    if (!result) {
      console.warn('[topicTagger] Could not parse LLM response:', response.content.slice(0, 200));
      return;
    }

    // Debounce: skip DB write if topic + file_paths are identical to last tag
    if (isDuplicate(sessionId, result)) {
      console.log(`[topicTagger] Debounced duplicate tag: "${result.topic}" for session ${sessionId}`);
      return;
    }

    // Store the topic
    await upsertTopic({
      topic: result.topic,
      file_paths: result.file_paths,
      directories: result.directories,
    });

    // Update debounce state
    updateSessionState(sessionId, result);

    // Increment session count only once per topic per session
    const state = sessionStates.get(sessionId);
    if (state && !state.seenTopics.has(result.topic)) {
      state.seenTopics.add(result.topic);
      await incrementSessionCount(result.topic);
    }

    console.log(
      `[topicTagger] Tagged session ${sessionId}: topic="${result.topic}", files=${result.file_paths.length}, dirs=${result.directories.length}`,
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[topicTagger] tagCurrentWork failed for session ${sessionId}: ${errorMsg}`);
  }
}

// ---------------------------------------------------------------------------
// Public API: cleanupSession — remove debounce state when session ends
// ---------------------------------------------------------------------------

export function cleanupSession(sessionId: string): void {
  sessionStates.delete(sessionId);
  console.log(`[topicTagger] Cleaned up session state for ${sessionId}`);
}
