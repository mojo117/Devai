import { useRef, useState, useCallback, useEffect, type RefObject } from 'react';
import { Spinner } from '../ui';

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
  isTranscribing: boolean;
  onTranscribe: (audioBlob: Blob) => void;
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
  isTranscribing,
  onTranscribe,
}: InputAreaProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
          onTranscribe(blob);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      // Permission denied or no microphone
    }
  }, [onTranscribe]);

  // Close plus menu on outside click
  useEffect(() => {
    if (!plusMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [plusMenuOpen]);

  const handleDictateClick = useCallback(() => {
    setPlusMenuOpen(false);
    if (isRecording) {
      stopRecording();
    } else if (!isTranscribing) {
      startRecording();
    }
  }, [isRecording, isTranscribing, startRecording, stopRecording]);

  const handleAttachClick = useCallback(() => {
    setPlusMenuOpen(false);
    fileInputRef.current?.click();
  }, [fileInputRef]);

  return (
    <form onSubmit={onSubmit} className="border-t border-devai-border p-3 sm:p-4">
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
      <div className="flex gap-1.5 sm:gap-2 items-center">
        {/* Plus button with popup menu */}
        <div className="relative" ref={plusMenuRef}>
          <button
            type="button"
            onClick={() => {
              if (isRecording) { stopRecording(); return; }
              setPlusMenuOpen((v) => !v);
            }}
            className={`flex items-center justify-center w-10 h-10 rounded-xl border transition-colors shrink-0 ${
              isRecording
                ? 'bg-red-600 border-red-500 text-white animate-pulse'
                : isTranscribing || isFileUploading
                  ? 'bg-devai-card border-devai-border text-devai-text-muted'
                  : plusMenuOpen
                    ? 'bg-devai-card border-devai-border-light text-devai-text'
                    : 'bg-devai-card border-devai-border text-devai-text-secondary hover:text-devai-text hover:border-devai-border-light'
            }`}
            title={isRecording ? 'Tap to stop recording' : 'Attach or dictate'}
          >
            {isTranscribing ? (
              <Spinner />
            ) : isRecording ? (
              /* Stop icon */
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : isFileUploading ? (
              <Spinner />
            ) : (
              /* Plus icon — rotates to X when menu open */
              <svg className={`w-5 h-5 transition-transform duration-200 ${plusMenuOpen ? 'rotate-45' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
          </button>

          {/* Popup menu */}
          {plusMenuOpen && (
            <div className="absolute bottom-12 left-0 bg-devai-surface border border-devai-border rounded-lg shadow-lg overflow-hidden z-20 min-w-[160px]">
              <button
                type="button"
                onClick={handleAttachClick}
                disabled={isFileUploading}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-devai-text-secondary hover:bg-devai-card hover:text-devai-text transition-colors disabled:opacity-50"
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                Attach
              </button>
              <button
                type="button"
                onClick={handleDictateClick}
                disabled={isTranscribing}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-devai-text-secondary hover:bg-devai-card hover:text-devai-text transition-colors disabled:opacity-50"
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z" />
                </svg>
                Dictate
              </button>
            </div>
          )}
        </div>

        {/* Input field */}
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            value={isRecording ? 'Recording...' : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Message... (@ for files)"
            disabled={isLoading || isRecording}
            className="w-full bg-devai-card border border-devai-border rounded-xl px-3 sm:px-4 py-2.5 text-sm text-devai-text placeholder-devai-text-muted focus:outline-none focus:border-devai-border-light focus:ring-1 focus:ring-devai-accent/30 disabled:opacity-50"
          />
          {fileHints.length > 0 && (
            <div className="absolute bottom-12 left-0 right-0 bg-devai-surface border border-devai-border rounded-lg shadow-lg max-h-48 overflow-y-auto text-xs z-20">
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
            <div className="absolute bottom-12 left-0 right-0 text-[10px] text-devai-text-muted bg-devai-surface border border-devai-border rounded-lg px-3 py-2 z-20">
              Searching files...
            </div>
          )}
          {fileHintsError && (
            <div className="absolute bottom-12 left-0 right-0 text-[10px] text-red-300 bg-devai-surface border border-devai-border rounded-lg px-3 py-2 z-20">
              {fileHintsError}
            </div>
          )}
        </div>

        {/* Send button — icon only */}
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-devai-accent hover:bg-devai-accent-hover text-white transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Send message"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileUpload}
          multiple
        />
      </div>
    </form>
  );
}
