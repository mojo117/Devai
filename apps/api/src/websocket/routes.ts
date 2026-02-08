import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { registerClient, unregisterClient, getConnectionStats } from './actionBroadcaster.js';
import { getPendingActions } from '../actions/manager.js';

export const websocketRoutes: FastifyPluginAsync = async (app) => {
  // WebSocket endpoint for real-time action updates
  app.get('/ws/actions', { websocket: true }, (socket: WebSocket, request) => {
    // Parse session ID from query params
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('sessionId') || undefined;

    // Register client
    registerClient(socket, sessionId);

    // Send initial pending actions on connect
    (async () => {
      try {
        const pendingActions = await getPendingActions();
        if (pendingActions.length > 0) {
          socket.send(JSON.stringify({
            type: 'initial_sync',
            actions: pendingActions,
            timestamp: new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.error('[WS] Failed to send initial pending actions:', err);
      }
    })();

    // Handle incoming messages (ping/pong, acknowledgments)
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }

        // Could add acknowledgment handling here for guaranteed delivery
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      unregisterClient(socket, sessionId);
    });

    socket.on('error', (err) => {
      console.error('[WS] Socket error:', err);
      unregisterClient(socket, sessionId);
    });
  });

  // HTTP endpoint to check WebSocket stats (useful for debugging)
  app.get('/ws/stats', async () => {
    return getConnectionStats();
  });
};
