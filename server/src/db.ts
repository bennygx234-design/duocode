import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

// Re-export the Database type so other modules can use it
export type Database = BetterSqlite3.Database;

// ---------------------------------------------------------------------------
// Database initialisation
// ---------------------------------------------------------------------------

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'duocode.db');
export const db: Database = new BetterSqlite3(DB_PATH) as Database;

/** Returns the singleton database instance (alias for direct db import). */
export function getDb(): Database {
  return db;
}

// Enable WAL for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema migrations
// ---------------------------------------------------------------------------

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id               INTEGER UNIQUE NOT NULL,
      login                   TEXT NOT NULL,
      username                TEXT NOT NULL,
      name                    TEXT,
      display_name            TEXT,
      avatar_url              TEXT,
      access_token_encrypted  TEXT NOT NULL,
      created_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_settings (
      user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      agent_name              TEXT NOT NULL DEFAULT 'Duo',
      agent_role              TEXT NOT NULL DEFAULT 'AI coding collaborator',
      role_description        TEXT NOT NULL DEFAULT 'AI coding collaborator',
      accent_color            TEXT NOT NULL DEFAULT '#6366f1',
      default_branch_behavior TEXT NOT NULL DEFAULT 'feature',
      repo_owner              TEXT,
      repo_name               TEXT,
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id  TEXT NOT NULL DEFAULT 'default',
      role        TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
      content     TEXT NOT NULL,
      tool_calls  TEXT,
      timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_user_session
      ON conversation_history(user_id, session_id, timestamp);

    -- chat_messages: used by the agent runner directly
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id  TEXT NOT NULL DEFAULT 'default',
      role        TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_user_session
      ON chat_messages(user_id, session_id, id);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_active TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM)
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 16;
const TAG_BYTES = 16;

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? 'fallback-secret-change-in-production';
  // Stretch / normalise to exactly 32 bytes using SHA-256
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(ciphertext: string): string {
  const key = deriveKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// Row types (internal DB layer)
// ---------------------------------------------------------------------------

export interface UserRow {
  id: number;
  github_id: number;
  login: string;
  /** Alias of login — kept for compatibility with agent code */
  username: string;
  name: string | null;
  /** Alias of name — kept for compatibility with agent code */
  display_name: string | null;
  avatar_url: string | null;
  access_token_encrypted: string;
  created_at: string;
}

export interface WorkspaceSettingsRow {
  user_id: number;
  agent_name: string;
  agent_role: string;
  role_description: string;
  accent_color: string;
  default_branch_behavior: string;
  repo_owner: string | null;
  repo_name: string | null;
  updated_at: string;
}

export interface ConversationMessageRow {
  id: number;
  user_id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: string | null;
  timestamp: string;
}

export interface AgentSessionRow {
  user_id: number;
  last_active: string;
}

// ---------------------------------------------------------------------------
// CRUD helpers — Users
// ---------------------------------------------------------------------------

export interface UpsertUserParams {
  github_id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
  access_token: string; // plain-text; will be encrypted
}

export function upsertUser(params: UpsertUserParams): UserRow {
  const encrypted = encryptToken(params.access_token);

  db.prepare(`
    INSERT INTO users (github_id, login, username, name, display_name, avatar_url, access_token_encrypted)
    VALUES (@github_id, @login, @login, @name, @name, @avatar_url, @access_token_encrypted)
    ON CONFLICT(github_id) DO UPDATE SET
      login                  = excluded.login,
      username               = excluded.login,
      name                   = excluded.name,
      display_name           = excluded.name,
      avatar_url             = excluded.avatar_url,
      access_token_encrypted = excluded.access_token_encrypted
  `).run({
    github_id: params.github_id,
    login: params.login,
    name: params.name ?? params.login,
    avatar_url: params.avatar_url ?? null,
    access_token_encrypted: encrypted,
  });

  return db
    .prepare<{ github_id: number }, UserRow>('SELECT * FROM users WHERE github_id = @github_id')
    .get({ github_id: params.github_id })!;
}

export function getUser(id: number): UserRow | undefined {
  return db
    .prepare<{ id: number }, UserRow>('SELECT * FROM users WHERE id = @id')
    .get({ id });
}

export function getUserByGithubId(githubId: number): UserRow | undefined {
  return db
    .prepare<{ github_id: number }, UserRow>('SELECT * FROM users WHERE github_id = @github_id')
    .get({ github_id: githubId });
}

export function getAllUsers(): UserRow[] {
  return db.prepare<[], UserRow>('SELECT * FROM users').all();
}

// ---------------------------------------------------------------------------
// CRUD helpers — Workspace Settings
// ---------------------------------------------------------------------------

export interface SaveSettingsParams {
  user_id: number;
  agent_name?: string;
  role_description?: string;
  accent_color?: string;
  default_branch_behavior?: string;
  repo_owner?: string | null;
  repo_name?: string | null;
}

export function saveSettings(params: SaveSettingsParams): WorkspaceSettingsRow {
  db.prepare(`
    INSERT INTO workspace_settings
      (user_id, agent_name, agent_role, role_description, accent_color, default_branch_behavior, repo_owner, repo_name, updated_at)
    VALUES
      (@user_id, @agent_name, @role_description, @role_description, @accent_color, @default_branch_behavior, @repo_owner, @repo_name, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      agent_name              = COALESCE(@agent_name, agent_name),
      agent_role              = COALESCE(@role_description, agent_role),
      role_description        = COALESCE(@role_description, role_description),
      accent_color            = COALESCE(@accent_color, accent_color),
      default_branch_behavior = COALESCE(@default_branch_behavior, default_branch_behavior),
      repo_owner              = COALESCE(@repo_owner, repo_owner),
      repo_name               = COALESCE(@repo_name, repo_name),
      updated_at              = datetime('now')
  `).run({
    user_id: params.user_id,
    agent_name: params.agent_name ?? null,
    role_description: params.role_description ?? null,
    accent_color: params.accent_color ?? null,
    default_branch_behavior: params.default_branch_behavior ?? null,
    repo_owner: params.repo_owner ?? null,
    repo_name: params.repo_name ?? null,
  });

  return getSettings(params.user_id)!;
}

export function getSettings(userId: number): WorkspaceSettingsRow | undefined {
  return db
    .prepare<{ user_id: number }, WorkspaceSettingsRow>(
      'SELECT * FROM workspace_settings WHERE user_id = @user_id'
    )
    .get({ user_id: userId });
}

// ---------------------------------------------------------------------------
// CRUD helpers — Conversation History
// ---------------------------------------------------------------------------

export interface SaveMessageParams {
  user_id: number;
  session_id?: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: unknown[] | null;
}

export function saveMessage(params: SaveMessageParams): ConversationMessageRow {
  const result = db.prepare(`
    INSERT INTO conversation_history (user_id, session_id, role, content, tool_calls)
    VALUES (@user_id, @session_id, @role, @content, @tool_calls)
  `).run({
    user_id: params.user_id,
    session_id: params.session_id ?? 'default',
    role: params.role,
    content: params.content,
    tool_calls: params.tool_calls ? JSON.stringify(params.tool_calls) : null,
  });

  return db
    .prepare<{ id: number }, ConversationMessageRow>(
      'SELECT * FROM conversation_history WHERE id = @id'
    )
    .get({ id: result.lastInsertRowid as number })!;
}

export interface GetMessagesOptions {
  session_id?: string;
  limit?: number;
}

export function getMessages(
  userId: number,
  options: GetMessagesOptions = {}
): ConversationMessageRow[] {
  const sessionId = options.session_id ?? 'default';
  const limit = options.limit ?? 100;

  return db
    .prepare<{ user_id: number; session_id: string; limit: number }, ConversationMessageRow>(`
      SELECT * FROM conversation_history
      WHERE user_id = @user_id AND session_id = @session_id
      ORDER BY timestamp ASC
      LIMIT @limit
    `)
    .all({ user_id: userId, session_id: sessionId, limit });
}

export function clearMessages(userId: number, sessionId = 'default'): void {
  db.prepare(
    'DELETE FROM conversation_history WHERE user_id = @user_id AND session_id = @session_id'
  ).run({ user_id: userId, session_id: sessionId });
}

// ---------------------------------------------------------------------------
// CRUD helpers — Agent Sessions
// ---------------------------------------------------------------------------

export function updateAgentSession(userId: number): void {
  db.prepare(`
    INSERT INTO agent_sessions (user_id, last_active)
    VALUES (@user_id, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET last_active = datetime('now')
  `).run({ user_id: userId });
}

export function getAgentSession(userId: number): AgentSessionRow | undefined {
  return db
    .prepare<{ user_id: number }, AgentSessionRow>(
      'SELECT * FROM agent_sessions WHERE user_id = @user_id'
    )
    .get({ user_id: userId });
}

// ---------------------------------------------------------------------------
// Compatibility aliases
// ---------------------------------------------------------------------------

/** Alias for getSettings — used by agent route code */
export const getWorkspaceSettings = getSettings;
