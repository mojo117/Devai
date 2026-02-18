import type { RefObject } from 'react';

interface RetryState {
  input: string;
  runRequest: () => Promise<unknown>;
}

interface InputAreaProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  retryState: RetryState | null;
  onRetry: () => void;
  fileHints: string[];
  fileHintsLoading: boolean;
  fileHintsError: string | null;
  activeHintIndex: number;
  onPickHint: (hint: string) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  isFileUploading: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function InputArea({
  input,
  setInput,
  isLoading,
  onSubmit,
  retryState,
  onRetry,
  fileHints,
  fileHintsLoading,
  fileHintsError,
  activeHintIndex,
  onPickHint,
  onInputKeyDown,
  isFileUploading,
  fileInputRef,
  onFileUpload,
}: InputAreaProps) {
  return (
    <form onSubmit={onSubmit} className="border-t border-devai-border p-4">
      {retryState && !isLoading && (
        <div className="mb-2 flex items-center justify-between bg-devai-card border border-devai-border rounded px-3 py-2 text-xs text-devai-text-secondary">
          <span>Last message failed.</span>
          <button
            type="button"
            onClick={onRetry}
            className="text-devai-accent hover:text-devai-accent-hover"
          >
            Retry
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Type your message... (use @ to quick-open files)"
            disabled={isLoading}
            className="w-full bg-devai-card border border-devai-border rounded-xl px-4 py-2.5 text-devai-text placeholder-devai-text-muted focus:outline-none focus:border-devai-border-light focus:ring-1 focus:ring-devai-accent/30 disabled:opacity-50"
          />
          {fileHints.length > 0 && (
            <div className="absolute bottom-12 left-0 right-0 bg-devai-surface border border-devai-border rounded-lg shadow-lg max-h-48 overflow-y-auto text-xs">
              {fileHints.map((hint, idx) => (
                <button
                  type="button"
                  key={hint}
                  onClick={() => onPickHint(hint)}
                  className={`w-full text-left px-3 py-2 ${
                    idx === activeHintIndex ? 'bg-devai-card text-devai-text' : 'text-devai-text-secondary hover:bg-devai-card'
                  }`}
                >
                  {hint}
                </button>
              ))}
            </div>
          )}
          {fileHintsLoading && (
            <div className="absolute bottom-12 left-0 right-0 text-[10px] text-devai-text-muted bg-devai-surface border border-devai-border rounded-lg px-3 py-2">
              Searching files...
            </div>
          )}
          {fileHintsError && (
            <div className="absolute bottom-12 left-0 right-0 text-[10px] text-red-300 bg-devai-surface border border-devai-border rounded-lg px-3 py-2">
              {fileHintsError}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-devai-accent hover:bg-devai-accent-hover disabled:bg-devai-border disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-medium transition-colors"
        >
          Send
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileUpload}
          multiple
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isFileUploading}
          className="bg-devai-card hover:bg-devai-card/80 border border-devai-border text-devai-text-secondary hover:text-devai-text disabled:opacity-50 px-3 py-2.5 rounded-xl transition-colors"
          title="Upload files to /opt/Userfiles"
        >
          {isFileUploading ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          )}
        </button>
      </div>
    </form>
  );
}
