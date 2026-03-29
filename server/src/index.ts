import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';

// ---------------------------------------------------------------------------
// Database — run migrations before anything else
// ---------------------------------------------------------------------------

import { runMigrations } from './db';
runMigrations();
console.log('[DB] Migrations complete');

// ---------------------------------------------------------------------------
// Routers
// ---------------------------------------------------------------------------

import authRouter from './routes/auth';
import repoRouter from './routes/repo';
import collaboratorRouter from './routes/collaborator';
import workspaceRouter from './routes/workspace';
import webhookRouter from './routes/webhook';
import agentRouter from './routes/agent';

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

import { initWebSocketServer } from './websocket';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();

// Trust proxy headers when running behind a reverse proxy (nginx, etc.)
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, mobile apps, etc.) and the configured client origin
      if (!origin || origin === CLIENT_ORIGIN) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256'],
  })
);

// ---------------------------------------------------------------------------
// Session middleware
// ---------------------------------------------------------------------------

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'change-me-in-production-please';
const isProd = process.env.NODE_ENV === 'production';

// Use connect-sqlite3 as the session store so sessions survive server restarts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SQLiteStore = require('connect-sqlite3')(session);

app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: path.join(__dirname, '..'),
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// ---------------------------------------------------------------------------
// Body parsing
// NOTE: The webhook route needs the raw body for HMAC verification, so we
// mount it BEFORE express.json() and handle body parsing internally.
// ---------------------------------------------------------------------------

// Webhook route — raw body (must come before express.json())
app.use('/api/github/webhook', webhookRouter);

// Standard JSON body parsing for all other routes
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API routers
// ---------------------------------------------------------------------------

app.use('/api/auth', authRouter);
app.use('/api/repo', repoRouter);
app.use('/api/collaborator', collaboratorRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/agent', agentRouter);

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[Error]', err.stack ?? err.message);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
);

// ---------------------------------------------------------------------------
// HTTP server + WebSocket server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const httpServer = http.createServer(app);

// Attach WebSocket server to the same HTTP server
initWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[Server] DuoCode API listening on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV ?? 'development'}`);
});

export default app;
