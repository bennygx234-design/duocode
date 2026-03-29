import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import type { WSEvent, WSEventPayload } from 'duocode-shared';
import { getAllUsers } from './db';
import type { Database } from './db';

// ---------------------------------------------------------------------------
// Connection registry: userId -> WebSocket
// ---------------------------------------------------------------------------

const connections = new Map<number, WebSocket>();

// ---------------------------------------------------------------------------
// Initialise WebSocket server attached to the existing HTTP server
// ---------------------------------------------------------------------------

export function initWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Extract userId from query string: /ws?userId=<id>
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const rawId = url.searchParams.get('userId');
    const userId = rawId ? parseInt(rawId, 10) : null;

    if (!userId || isNaN(userId)) {
      ws.close(1008, 'Missing or invalid userId');
      return;
    }

    // Replace any stale connection for this user
    const existing = connections.get(userId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      existing.close(1001, 'Replaced by newer connection');
    }

    connections.set(userId, ws);
    console.log(`[WS] User ${userId} connected (total: ${connections.size})`);

    // Acknowledge connection
    safeSend(ws, { type: 'connected', userId, timestamp: new Date().toISOString() });

    // -----------------------------------------------------------------------
    // Ping / keepalive — browser sends { type: 'ping' }
    // -----------------------------------------------------------------------
    let isAlive = true;

    const heartbeat = setInterval(() => {
      if (!isAlive) {
        console.log(`[WS] User ${userId} timed out — terminating`);
        ws.terminate();
        return;
      }
      isAlive = false;
      ws.ping();
    }, 30_000);

    ws.on('pong', () => {
      isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          safeSend(ws, { type: 'pong', timestamp: new Date().toISOString() });
          isAlive = true;
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      // Only remove if it's still this socket (not replaced)
      if (connections.get(userId) === ws) {
        connections.delete(userId);
      }
      console.log(`[WS] User ${userId} disconnected (total: ${connections.size})`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error for user ${userId}:`, err.message);
    });
  });

  wss.on('error', (err) => {
    console.error('[WS] Server error:', err);
  });

  console.log('[WS] WebSocket server initialised on /ws');
  return wss;
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function broadcastToUser(userId: number, event: WSEvent): boolean {
  const ws = connections.get(userId);
  if (!ws) return false;
  safeSend(ws, event);
  return true;
}

export function broadcastCollaboratorActivity(
  recipientUserId: number,
  actorUsername: string,
  payload: WSEvent['payload']
): boolean {
  const event: WSEvent = {
    type: 'collaborator_action',
    payload,
    timestamp: new Date().toISOString(),
  };
  return broadcastToUser(recipientUserId, event);
}

export function isUserConnected(userId: number): boolean {
  const ws = connections.get(userId);
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function getConnectedUserIds(): number[] {
  return Array.from(connections.keys()).filter((id) => {
    const ws = connections.get(id);
    return ws && ws.readyState === WebSocket.OPEN;
  });
}

/**
 * broadcastToCollaborator — used by the agent runner.
 * Finds the other user in the DB (the one who is NOT sourceUserId) and
 * broadcasts an event to them if they have an open WebSocket connection.
 *
 * @param _db  The database instance (unused here — we use the module-level getAllUsers)
 * @param sourceUserId  The user who triggered the action
 * @param event  The WS event to deliver
 */
export function broadcastToCollaborator(
  _db: Database,
  sourceUserId: number,
  event: { type: string; payload: WSEventPayload; timestamp: string }
): void {
  const allUsers = getAllUsers();
  const collaborator = allUsers.find((u) => u.id !== sourceUserId);
  if (!collaborator) return;

  broadcastToUser(collaborator.id, event as WSEvent);
}
