import { LLMProvider } from '../types';

interface ProviderSelectorProps {
  selectedProvider: LLMProvider;
  onProviderChange: (provider: LLMProvider) => void;
  availableProviders: {
    anthropic: boolean;
    openai: boolean;
    gemini: boolean;
  };
  disabled?: boolean;
}

const PROVIDER_INFO: Record<LLMProvider, { name: string; icon: string; color: string }> = {
  anthropic: { name: 'Claude', icon: '🟠', color: 'orange' },
  openai: { name: 'GPT', icon: '🟢', color: 'green' },
  gemini: { name: 'Gemini', icon: '🔵', color: 'blue' },
};

export function ProviderSelector({
  selectedProvider,
  onProviderChange,
  availableProviders,
  disabled = false,
}: ProviderSelectorProps) {
  const providers: LLMProvider[] = ['anthropic', 'openai', 'gemini'];

  return (
    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
      {providers.map((provider) => {
        const info = PROVIDER_INFO[provider];
        const isAvailable = availableProviders[provider];
        const isSelected = selectedProvider === provider;

        return (
          <button
            key={provider}
            onClick={() => isAvailable && onProviderChange(provider)}
            disabled={disabled || !isAvailable}
            className={`
              px-3 py-1.5 rounded-md text-sm font-medium transition-all
              ${isSelected
                ? 'bg-gray-700 text-white shadow-sm'
                : isAvailable
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  : 'text-gray-600 cursor-not-allowed'
              }
            `}
            title={isAvailable ? info.name : `${info.name} (not configured)`}
          >
            <span className="mr-1">{info.icon}</span>
            {info.name}
          </button>
        );
      })}
    </div>
  );
}
