import type { LLMProvider } from '../types';

interface ProviderSelectProps {
  value: LLMProvider;
  onChange: (provider: LLMProvider) => void;
  available?: {
    anthropic: boolean;
    openai: boolean;
    gemini: boolean;
  };
}

const providers: { value: LLMProvider; label: string }[] = [
  { value: 'anthropic', label: 'Claude (Anthropic)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini (Google)' },
];

export function ProviderSelect({ value, onChange, available }: ProviderSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-400">Provider:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LLMProvider)}
        className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      >
        {providers.map((p) => {
          const isAvailable = available?.[p.value] ?? true;
          return (
            <option
              key={p.value}
              value={p.value}
              disabled={!isAvailable}
            >
              {p.label} {!isAvailable && '(not configured)'}
            </option>
          );
        })}
      </select>
    </div>
  );
}
