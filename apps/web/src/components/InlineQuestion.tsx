import { useState } from 'react';

export interface PendingQuestion {
  questionId: string;
  question: string;
  options?: string[];
  context?: string;
  fromAgent?: string;
  timestamp?: string;
  sessionId?: string;
}

interface InlineQuestionProps {
  question: PendingQuestion;
  onSubmit: (questionId: string, answer: string) => Promise<void>;
}

export function InlineQuestion({ question, onSubmit }: InlineQuestionProps) {
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'pending' | 'submitting' | 'submitted' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    setStatus('submitting');
    setError(null);
    try {
      await onSubmit(question.questionId, trimmed);
      setStatus('submitted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
      setStatus('error');
    }
  };

  if (status === 'submitted') {
    return (
      <div className="bg-blue-900/30 border border-blue-600 rounded-lg p-3 my-2">
        <div className="flex items-center gap-2">
          <span className="text-devai-accent">Question answered</span>
          <span className="font-mono text-sm text-devai-text-secondary">{question.fromAgent ? `from ${question.fromAgent}` : ''}</span>
        </div>
      </div>
    );
  }

  const isLoading = status === 'submitting';

  return (
    <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3 my-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-devai-accent text-sm">Clarification needed</span>
        {question.fromAgent && (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-700/30 text-blue-100 uppercase">
            {question.fromAgent}
          </span>
        )}
      </div>

      <p className="text-sm text-devai-text whitespace-pre-wrap mb-2">{question.question}</p>
      {question.context && (
        <p className="text-xs text-devai-text-secondary whitespace-pre-wrap mb-2">{question.context}</p>
      )}

      {Array.isArray(question.options) && question.options.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {question.options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setAnswer(opt)}
              disabled={isLoading}
              className="text-xs px-2 py-1 rounded bg-devai-card hover:bg-devai-card disabled:bg-devai-bg text-devai-text"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

      <div className="flex items-start gap-2">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={2}
          disabled={isLoading}
          className="flex-1 bg-devai-bg border border-devai-border rounded px-2 py-1 text-sm text-devai-text"
          placeholder="Type your answer…"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading || !answer.trim()}
          className="bg-devai-accent hover:bg-blue-700 disabled:bg-blue-900 disabled:cursor-not-allowed text-white text-sm font-medium py-1.5 px-4 rounded transition-colors"
        >
          {isLoading ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

