import { useState, useRef, useCallback, useEffect } from 'react';

interface MarkdownEditorProps {
  content: string;
  onChange?: (newContent: string) => void;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}

export function MarkdownEditor({ content, onChange, onSave, onCancel }: MarkdownEditorProps) {
  const [editedContent, setEditedContent] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const hasChanges = editedContent !== content;
  const lineCount = editedContent.split('\n').length;

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Sync gutter scroll with textarea
  const handleScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // Tab key inserts 2 spaces
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = ta.value;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      setEditedContent(newValue);
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }

    // Ctrl+S / Cmd+S to save
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (hasChanges) {
        onSave(editedContent);
      }
    }

    // Escape to cancel
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [hasChanges, editedContent, onSave, onCancel]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Line number gutter */}
        <div
          ref={gutterRef}
          className="shrink-0 overflow-hidden select-none bg-devai-surface border-r border-devai-border text-right pr-2 pl-2 pt-4 pb-4"
          style={{ fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace", fontSize: '0.8rem', lineHeight: '1.5rem' }}
          aria-hidden="true"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="text-devai-text-muted/50">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Editor textarea */}
        <textarea
          ref={textareaRef}
          value={editedContent}
          onChange={(e) => {
            setEditedContent(e.target.value);
            onChange?.(e.target.value);
          }}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="flex-1 min-w-0 bg-devai-bg text-devai-text resize-none outline-none border-none pt-4 pb-4 px-3"
          style={{
            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
            fontSize: '0.8rem',
            lineHeight: '1.5rem',
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
