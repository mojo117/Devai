import { useRef, useState, useCallback, type RefObject } from 'react';
import { Spinner, Button } from '../ui';

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (!isRecording && !isTranscribing) {
      startRecording();
    }
  }, [isRecording, isTranscribing, startRecording]);

  const handlePointerUp = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

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
        <Button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-6 py-2.5 disabled:bg-devai-border"
        >
          Send
        </Button>
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
          disabled={isTranscribing}
          className={`transition-colors text-sm px-3 py-2 rounded-xl border disabled:opacity-50 disabled:cursor-not-allowed ${
            isRecording
              ? 'bg-red-600 border-red-500 text-white animate-pulse'
              : 'bg-devai-card hover:bg-devai-card/80 border-devai-border text-devai-text-secondary hover:text-devai-text'
          }`}
          title={isRecording ? 'Recording... release to stop' : 'Hold to dictate'}
        >
          {isTranscribing ? (
            <Spinner />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z" />
            </svg>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileUpload}
          multiple
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={isFileUploading}
          className="px-3 py-2.5"
          title="Upload files to /opt/Userfiles"
        >
          {isFileUploading ? (
            <Spinner />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          )}
        </Button>
      </div>
    </form>
  );
}
