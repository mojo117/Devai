import { useEffect, useCallback, useState } from 'react';
import type { Action } from '../types';
import { ensureControlPlaneConnected, isControlPlaneConnected, subscribeActionEvents } from '../api';

interface ActionWebSocketEvent {
  type: 'action_pending' | 'action_updated' | 'action_created' | 'initial_sync' | 'pong';
  action?: Action;
  actions?: Action[];
  timestamp: string;
}

interface UseActionWebSocketOptions {
  sessionId?: string;
  onActionPending?: (action: Action) => void;
  onActionUpdated?: (action: Action) => void;
  onInitialSync?: (actions: Action[]) => void;
  enabled?: boolean;
}

interface UseActionWebSocketReturn {
  isConnected: boolean;
  reconnect: () => void;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
}

export function useActionWebSocket({
  sessionId,
  onActionPending,
  onActionUpdated,
  onInitialSync,
  enabled = true,
}: UseActionWebSocketOptions): UseActionWebSocketReturn {
  const debug = import.meta.env.DEV && Boolean((window as any).__DEVAI_DEBUG);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

  const reconnect = useCallback(() => {
    if (!enabled) return;
    setConnectionState('connecting');
    ensureControlPlaneConnected()
      .then(() => setConnectionState('connected'))
      .catch(() => setConnectionState('error'));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setConnectionState('disconnected');
      return;
    }

    let cancelled = false;

    setConnectionState('connecting');
    ensureControlPlaneConnected()
      .then(() => {
        if (!cancelled) setConnectionState('connected');
      })
      .catch(() => {
        if (!cancelled) setConnectionState('error');
      });

    const unsubscribe = subscribeActionEvents((raw) => {
      const data = raw as unknown as ActionWebSocketEvent;
      if (debug) console.log('[WS/control] action event:', data.type, data);

      switch (data.type) {
        case 'action_pending':
        case 'action_created':
          if (data.action && onActionPending) onActionPending(data.action);
          break;
        case 'action_updated':
          if (data.action && onActionUpdated) onActionUpdated(data.action);
          break;
        case 'initial_sync':
          if (data.actions && onInitialSync) onInitialSync(data.actions);
          break;
        case 'pong':
          break;
      }
    });

    // Reflect connection state changes from the shared control plane.
    const interval = window.setInterval(() => {
      const connected = isControlPlaneConnected();
      setConnectionState((prev) => {
        if (connected) return 'connected';
        if (prev === 'error') return prev;
        return 'disconnected';
      });
    }, 1000);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(interval);
    };
    // sessionId is kept for API compatibility but not used anymore (actions are global).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, debug, sessionId, onActionPending, onActionUpdated, onInitialSync]);

  return {
    isConnected: connectionState === 'connected',
    reconnect,
    connectionState,
  };
}
