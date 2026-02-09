import { useEffect, useRef, useCallback, useState } from 'react';
import type { Action } from '../types';

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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

  const connect = useCallback(() => {
    if (!enabled) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    let wsUrl = `${protocol}//${host}/api/ws/actions`;

    if (sessionId) {
      wsUrl += `?sessionId=${encodeURIComponent(sessionId)}`;
    }

    if (debug) console.log('[WS] Connecting to', wsUrl);
    setConnectionState('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (debug) console.log('[WS] Connected');
        setConnectionState('connected');
        reconnectAttempts.current = 0;

        // Start ping interval to keep connection alive
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ActionWebSocketEvent;
          if (debug) console.log('[WS] Received:', data.type, data);

          switch (data.type) {
            case 'action_pending':
            case 'action_created':
              if (data.action && onActionPending) {
                onActionPending(data.action);
              }
              break;

            case 'action_updated':
              if (data.action && onActionUpdated) {
                onActionUpdated(data.action);
              }
              break;

            case 'initial_sync':
              if (data.actions && onInitialSync) {
                onInitialSync(data.actions);
              }
              break;

            case 'pong':
              // Connection is alive
              break;
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      ws.onclose = (event) => {
        if (debug) console.log('[WS] Disconnected', event.code, event.reason);
        setConnectionState('disconnected');

        // Clean up ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Schedule reconnect with exponential backoff
        if (enabled && reconnectAttempts.current < 100) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;
          if (debug) console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        if (debug) console.error('[WS] Error:', error);
        setConnectionState('error');
      };
    } catch (err) {
      if (debug) console.error('[WS] Failed to create WebSocket:', err);
      setConnectionState('error');
    }
  }, [debug, enabled, sessionId, onActionPending, onActionUpdated, onInitialSync]);

  const reconnect = useCallback(() => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset reconnect counter and connect
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  // Connect on mount and when dependencies change
  useEffect(() => {
    connect();

    return () => {
      // Cleanup on unmount
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    isConnected: connectionState === 'connected',
    reconnect,
    connectionState,
  };
}
