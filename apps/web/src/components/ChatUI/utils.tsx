import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ToolEvent, ToolEventUpdate } from './types';

export function renderMessageContent(content: string) {
  return <MarkdownMessage content={content} />;
}

function MarkdownMessage({ content }: { content: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(content, { async: false, gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(raw);
  }, [content]);

  return (
    <div
      className="prose-chat text-sm leading-relaxed break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
