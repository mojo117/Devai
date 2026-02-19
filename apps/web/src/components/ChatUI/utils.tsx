import type { Dispatch, SetStateAction } from 'react';
import DOMPurify from 'dompurify';
import type { ToolEvent, ToolEventUpdate } from './types';

export function renderMessageContent(content: string) {
  // Sanitize content: strip all HTML tags before markdown-like rendering
  const clean = DOMPurify.sanitize(content, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  // Simple markdown-like rendering for bold, code blocks, and inline code
  const parts = clean.split(/(```[\s\S]*?```|\*\*.*?\*\*|`[^`]+`)/g);

  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((part, i) => {
        // Code block
        if (part.startsWith('```') && part.endsWith('```')) {
          const codeContent = part.slice(3, -3);
          // Strip optional language identifier from first line
          const firstNewline = codeContent.indexOf('\n');
          const code = firstNewline > -1 ? codeContent.slice(firstNewline + 1) : codeContent;
          return (
            <pre key={i} className="bg-devai-bg border border-devai-border rounded-lg p-3 my-2 text-xs overflow-x-auto font-mono text-devai-text-secondary">
              {code}
            </pre>
          );
        }
        // Bold
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        // Inline code
        if (part.startsWith('`') && part.endsWith('`') && !part.startsWith('```')) {
          return (
            <code key={i} className="bg-devai-bg border border-devai-border rounded px-1.5 py-0.5 text-xs font-mono text-devai-accent">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

export function formatPayloadCompact(payload: unknown): string {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    if (text.length > 300) {
      return `${text.slice(0, 300)}\n...`;
    }
    return text;
  } catch {
    return String(payload);
  }
}

export function extractAtToken(input: string): { value: string; start: number; end: number } | null {
  const atIndex = input.lastIndexOf('@');
  if (atIndex === -1) return null;
  const after = input.slice(atIndex + 1);
  const match = after.match(/^[^\s]*/);
  if (!match) return null;
  return {
    value: match[0],
    start: atIndex,
    end: atIndex + 1 + match[0].length,
  };
}

export function escapeGlob(value: string): string {
  return value.replace(/([\\*?[\]{}()!])/g, '\\$1');
}

export function upsertToolEvent(
  setToolEvents: Dispatch<SetStateAction<ToolEvent[]>>,
  id: string,
  update: ToolEventUpdate
) {
  setToolEvents((prev) => {
    const index = prev.findIndex((event) => event.id === id);
    if (index === -1) {
      const initial: ToolEvent = {
        id,
        type: update.type,
        name: update.name,
        arguments: update.arguments,
        result: update.chunk || update.result,
        completed: update.completed,
        agent: update.agent,
      };
      return [...prev, initial];
    }

    const existing = prev[index];
    const next: ToolEvent = {
      ...existing,
      type: update.type ?? existing.type,
      name: update.name ?? existing.name,
      arguments: update.arguments ?? existing.arguments,
      completed: update.completed ?? existing.completed,
      result: update.result ?? existing.result,
      agent: update.agent ?? existing.agent,
    };

    if (update.chunk) {
      const current = typeof existing.result === 'string' ? existing.result : '';
      next.result = current + update.chunk;
    }

    const copy = [...prev];
    copy[index] = next;
    return copy;
  });
}
