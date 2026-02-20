import { useState, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { approveAction, rejectAction, fetchPendingActions, batchApproveActions, batchRejectActions } from '../../../api';
import type { ChatMessage, Action } from '../../../types';
import { useActionWebSocket } from '../../../hooks/useActionWebSocket';
import type { PendingAction } from '../../InlineAction';

interface UsePendingActionsOptions {
  sessionId: string | null;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  debug?: boolean;
}

export function usePendingActions({
  sessionId,
  setMessages,
  debug = false,
}: UsePendingActionsOptions) {
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);

  useEffect(() => {
    if (!debug) return;
    console.log('[ChatUI] pendingActions changed:', pendingActions.length, pendingActions);
  }, [debug, pendingActions]);

  // WebSocket handlers for real-time action updates
  const handleActionPending = useCallback((action: Action) => {
    if (debug) console.log('[ChatUI] handleActionPending called:', action);
    setPendingActions((prev) => {
      if (prev.some((a) => a.actionId === action.id)) return prev;
      return [
        ...prev,
        {
          actionId: action.id,
          toolName: action.toolName,
          toolArgs: action.toolArgs,
          description: action.description,
          preview: action.preview,
        },
      ];
    });
  }, [debug]);

  const handleActionUpdated = useCallback((action: Action) => {
    if (action.status !== 'pending') {
      setPendingActions((prev) => prev.filter((a) => a.actionId !== action.id));
    }
  }, []);

  const handleInitialSync = useCallback((actions: Action[]) => {
    setPendingActions((prev) => {
      const existingIds = new Set(prev.map((a) => a.actionId));
      const newActions = actions
        .filter((a) => a.status === 'pending' && !existingIds.has(a.id))
        .map((a) => ({
          actionId: a.id,
          toolName: a.toolName,
          toolArgs: a.toolArgs,
          description: a.description,
          preview: a.preview,
        }));
      if (newActions.length > 0) return [...prev, ...newActions];
      return prev;
    });
  }, []);

  // Connect to WebSocket for real-time action updates
  const { isConnected: wsConnected } = useActionWebSocket({
    sessionId: sessionId || undefined,
    onActionPending: handleActionPending,
    onActionUpdated: handleActionUpdated,
    onInitialSync: handleInitialSync,
    enabled: true,
  });

  // Fallback polling when WebSocket is disconnected
  useEffect(() => {
    if (wsConnected) return;
    let isMounted = true;

    const syncPendingActions = async () => {
      try {
        const data = await fetchPendingActions();
        if (!isMounted) return;
        setPendingActions((prev) => {
          const existingIds = new Set(prev.map((a) => a.actionId));
          const newActions = data.actions
            .filter((a) => !existingIds.has(a.id))
            .map((a) => ({
              actionId: a.id,
              toolName: a.toolName,
              toolArgs: a.toolArgs,
              description: a.description,
              preview: a.preview,
            }));
          if (newActions.length > 0) return [...prev, ...newActions];
          return prev;
        });
      } catch {
        // Silently ignore polling errors
      }
    };

    syncPendingActions();
    const interval = setInterval(syncPendingActions, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [wsConnected]);

  const handleApproveAction = useCallback(async (actionId: string) => {
    const pendingAction = pendingActions.find((a) => a.actionId === actionId);
    const response = await approveAction(actionId);

    const resultMessage: ChatMessage = {
      id: `action-result-${actionId}`,
      role: 'assistant',
      content: response.action.error
        ? `**Action failed:** ${pendingAction?.description || response.action.toolName}\n\nError: ${response.action.error}`
        : `**Action completed:** ${pendingAction?.description || response.action.toolName}\n\n${response.result ? '```json\n' + JSON.stringify(response.result, null, 2) + '\n```' : 'Success'}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, resultMessage]);

    setTimeout(() => {
      setPendingActions((prev) => prev.filter((a) => a.actionId !== actionId));
    }, 1000);
  }, [pendingActions, setMessages]);

  const handleRejectAction = useCallback(async (actionId: string) => {
    const pendingAction = pendingActions.find((a) => a.actionId === actionId);
    await rejectAction(actionId);

    const rejectMessage: ChatMessage = {
      id: `action-rejected-${actionId}`,
      role: 'assistant',
      content: `**Action rejected:** ${pendingAction?.description || 'Unknown action'}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, rejectMessage]);

    setTimeout(() => {
      setPendingActions((prev) => prev.filter((a) => a.actionId !== actionId));
    }, 1000);
  }, [pendingActions, setMessages]);

  const handleBatchApprove = useCallback(async () => {
    if (pendingActions.length === 0) return;
    const actionIds = pendingActions.map((a) => a.actionId);
    const actionDescriptions = new Map(pendingActions.map((a) => [a.actionId, a.description]));

    try {
      const response = await batchApproveActions(actionIds);
      const succeeded = response.results.filter((r) => r.success);
      const failed = response.results.filter((r) => !r.success);

      let content = `**Batch Approval Results:**\n\n`;
      if (succeeded.length > 0) {
        content += `**${succeeded.length} action(s) completed:**\n`;
        for (const r of succeeded) {
          content += `- ${actionDescriptions.get(r.actionId) || r.actionId}\n`;
        }
        content += '\n';
      }
      if (failed.length > 0) {
        content += `**${failed.length} action(s) failed:**\n`;
        for (const r of failed) {
          content += `- ${actionDescriptions.get(r.actionId) || r.actionId}: ${r.error || 'Unknown error'}\n`;
        }
      }

      setMessages((prev) => [...prev, {
        id: `batch-approved-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
      }]);
      setTimeout(() => setPendingActions([]), 500);
    } catch (error) {
      setMessages((prev) => [...prev, {
        id: `batch-error-${Date.now()}`,
        role: 'assistant',
        content: `**Batch approval failed:** ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      }]);
    }
  }, [pendingActions, setMessages]);

  const handleBatchReject = useCallback(async () => {
    if (pendingActions.length === 0) return;
    const actionIds = pendingActions.map((a) => a.actionId);

    try {
      await batchRejectActions(actionIds);
      setMessages((prev) => [...prev, {
        id: `batch-rejected-${Date.now()}`,
        role: 'assistant',
        content: `**Batch rejected:** ${actionIds.length} action(s) rejected`,
        timestamp: new Date().toISOString(),
      }]);
      setTimeout(() => setPendingActions([]), 500);
    } catch (error) {
      setMessages((prev) => [...prev, {
        id: `batch-error-${Date.now()}`,
        role: 'assistant',
        content: `**Batch rejection failed:** ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      }]);
    }
  }, [pendingActions, setMessages]);

  return {
    pendingActions,
    setPendingActions,
    handleApproveAction,
    handleRejectAction,
    handleBatchApprove,
    handleBatchReject,
  };
}
