import { useState, useEffect, useCallback } from 'react';
import { fetchGlobalContext, saveGlobalContext } from '../api';

interface GlobalContextProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalContext({ isOpen, onClose }: GlobalContextProps) {
  const [content, setContent] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGlobalContext();
      setContent(data.content);
      setEnabled(data.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load global context');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadContext();
    }
  }, [isOpen, loadContext]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await saveGlobalContext({ content: content.trim(), enabled });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save global context');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear the global context?')) {
      setContent('');
      setEnabled(true);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-devai-surface border border-devai-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-devai-border">
          <div>
            <h2 className="text-lg font-semibold text-devai-text">Global Context</h2>
            <p className="text-xs text-devai-text-muted">
              Context that will be included in every conversation with the AI
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-devai-text-secondary hover:text-devai-text transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-devai-text-muted">Loading...</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Enable/Disable Toggle */}
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-devai-border bg-devai-bg text-devai-accent focus:ring-devai-accent"
                />
                <span className="text-sm text-devai-text-secondary">
                  Enable global context in conversations
                </span>
              </label>

              {/* Context Input */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-devai-text-secondary">
                    Context Content
                  </label>
                  <span className="text-xs text-devai-text-muted">
                    {content.length} characters
                  </span>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter context information that should be available to the AI in every conversation..."
                  rows={12}
                  className="w-full bg-devai-bg border border-devai-border rounded-lg px-3 py-2 text-sm text-devai-text placeholder-devai-text-muted focus:outline-none focus:ring-2 focus:ring-devai-accent resize-none font-mono"
                />
                <p className="mt-2 text-xs text-devai-text-muted">
                  This context will be prepended to every conversation. Use it for information about coding standards, architecture decisions, or other project-wide knowledge.
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="p-3 bg-red-900/30 border border-red-700/50 rounded text-sm text-red-200">
                  {error}
                </div>
              )}

              {/* Success Message */}
              {saveSuccess && (
                <div className="p-3 bg-green-900/30 border border-green-700/50 rounded text-sm text-green-200">
                  Global context saved successfully!
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-devai-border">
          <button
            onClick={handleClear}
            disabled={saving || loading}
            className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            Clear
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-devai-text-secondary hover:text-devai-text transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-4 py-2 bg-devai-accent hover:bg-devai-accent-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
