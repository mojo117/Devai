import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { SessionSummary } from '../types';

interface UseCommandPaletteOptions {
  sessions: SessionSummary[];
  isDisabled?: boolean;
}

export function useCommandPalette({
  sessions,
  isDisabled = false,
}: UseCommandPaletteOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredSessions = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.toLowerCase();
    return sessions.filter((s) => {
      const title = (s.title || s.id.slice(0, 8)).toLowerCase();
      let qi = 0;
      for (let i = 0; i < title.length && qi < q.length; i++) {
        if (title[i] === q[qi]) qi++;
      }
      return qi === q.length;
    });
  }, [sessions, query]);

  const open = useCallback(() => {
    if (isDisabled) return;
    setQuery('');
    setActiveIndex(0);
    setIsOpen(true);
  }, [isDisabled]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) close(); else open();
  }, [isOpen, close, open]);

  // Focus input when palette opens
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [filteredSessions.length]);

  // Global Cmd/Ctrl+K and Escape listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggle, isOpen, close]);

  // Arrow key navigation inside the palette
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const count = filteredSessions.length + 1; // +1 for "New Session" action
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + count) % count);
    }
  }, [filteredSessions.length]);

  return {
    isOpen, open, close, toggle,
    query, setQuery,
    filteredSessions,
    activeIndex, setActiveIndex,
    inputRef,
    handleKeyDown,
  };
}
