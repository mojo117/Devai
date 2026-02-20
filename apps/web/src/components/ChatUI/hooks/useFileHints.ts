import { useState, useEffect, useCallback } from 'react';
import { globProjectFiles } from '../../../api';
import { extractAtToken, escapeGlob } from '../utils';

interface UseFileHintsOptions {
  input: string;
  setInput: (value: string) => void;
  allowedRoots?: string[];
  ignorePatterns?: string[];
  onPinFile?: (file: string) => void;
}

export function useFileHints({
  input,
  setInput,
  allowedRoots,
  ignorePatterns,
  onPinFile,
}: UseFileHintsOptions) {
  const [fileHints, setFileHints] = useState<string[]>([]);
  const [fileHintsLoading, setFileHintsLoading] = useState(false);
  const [fileHintsError, setFileHintsError] = useState<string | null>(null);
  const [activeHintIndex, setActiveHintIndex] = useState(0);

  useEffect(() => {
    const token = extractAtToken(input);
    if (!token) {
      setFileHints([]);
      setFileHintsError(null);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setFileHintsLoading(true);
      setFileHintsError(null);
      try {
        const basePath = allowedRoots && allowedRoots.length > 0 ? allowedRoots[0] : undefined;
        const safeToken = escapeGlob(token.value);
        const pattern = `**/*${safeToken}*`;
        const data = await globProjectFiles(pattern, basePath, ignorePatterns);
        if (cancelled) return;
        const files = data.files.slice(0, 20);
        setFileHints(files);
        setActiveHintIndex(0);
      } catch (err) {
        if (cancelled) return;
        setFileHints([]);
        setFileHintsError(err instanceof Error ? err.message : 'Failed to load file hints');
      } finally {
        if (!cancelled) setFileHintsLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [input, allowedRoots, ignorePatterns]);

  const handlePickHint = useCallback((hint: string) => {
    const token = extractAtToken(input);
    if (!token) return;
    const before = input.slice(0, token.start);
    const after = input.slice(token.end);
    const next = `${before}@${hint} ${after}`.replace(/\s{2,}/g, ' ');
    setInput(next);
    setFileHints([]);
    if (onPinFile) {
      onPinFile(hint);
    }
  }, [input, setInput, onPinFile]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (fileHints.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveHintIndex((prev) => (prev + 1) % fileHints.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveHintIndex((prev) => (prev - 1 + fileHints.length) % fileHints.length);
    } else if (e.key === 'Enter') {
      const token = extractAtToken(input);
      if (token && fileHints[activeHintIndex]) {
        e.preventDefault();
        handlePickHint(fileHints[activeHintIndex]);
      }
    } else if (e.key === 'Escape') {
      setFileHints([]);
    }
  }, [fileHints, activeHintIndex, input, handlePickHint]);

  return {
    fileHints,
    fileHintsLoading,
    fileHintsError,
    activeHintIndex,
    handlePickHint,
    handleInputKeyDown,
  };
}
