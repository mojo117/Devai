import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-devai-bg text-devai-text px-4">
          <div className="max-w-md w-full bg-devai-bg border border-devai-border rounded-lg p-6 shadow-xl text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h1 className="text-xl font-semibold text-red-400 mb-2">Something went wrong</h1>
            <p className="text-sm text-devai-text-secondary mb-4">
              The application encountered an unexpected error. This has been logged for debugging.
            </p>
            {this.state.error && (
              <pre className="text-xs text-left bg-devai-bg border border-devai-border rounded p-3 mb-4 overflow-auto max-h-32 text-red-300">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-devai-accent hover:bg-devai-accent-hover text-white rounded-md text-sm font-medium transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
