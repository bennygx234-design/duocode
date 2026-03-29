// =============================================================================
// DuoCode — Shared TypeScript Types
// Consumed by both /client and /server via the "duocode-shared" workspace pkg.
// =============================================================================

// ── User & Auth ──────────────────────────────────────────────────────────────

/** Full user row as stored in the database. */
export interface User {
  id: number;
  github_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  /** AES-256-GCM encrypted GitHub access token. Never send to the client. */
  github_token_encrypted: string;
  created_at: string; // ISO-8601
}

/** Safe subset of User that is embedded in the HTTP session and returned to the client. */
export interface SessionUser {
  id: number;
  github_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
}

/** Returned by GET /auth/me */
export interface AuthResponse {
  user: SessionUser;
}

// ── Session ──────────────────────────────────────────────────────────────────

/** Represents one chat session (conversation thread) between a user and the agent. */
export interface Session {
  id: string;          // UUID v4
  user_id: number;
  title: string;
  created_at: string;  // ISO-8601
  updated_at: string;  // ISO-8601
}

/** Input to create or rename a session. */
export interface SessionInput {
  title?: string;
}

// ── Workspace Settings ────────────────────────────────────────────────────────

/** Per-user workspace preferences stored in the database. */
export interface WorkspaceSettings {
  id: number;
  user_id: number;
  repo_owner: string;
  repo_name: string;
  /** Display name of the AI agent (e.g. "Aria"). */
  agent_name: string;
  /** One-line description of the agent's role (e.g. "Senior TypeScript engineer"). */
  agent_role: string;
  /** CSS colour token used to tint the UI (e.g. "#6366f1"). */
  accent_color: string;
  created_at: string;
  updated_at: string;
}

/** Body sent to POST /api/workspace or PATCH /api/workspace */
export interface WorkspaceSettingsInput {
  repo_owner: string;
  repo_name: string;
  agent_name?: string;
  agent_role?: string;
  accent_color?: string;
}

// ── Agent & Chat ──────────────────────────────────────────────────────────────

/** A single message in the conversation history (persisted to SQLite). */
export interface AgentMessage {
  id: number;
  session_id: string;
  user_id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Serialised tool-call records attached to this message turn (if any). */
  tool_calls?: ToolCallRecord[];
  created_at: string; // ISO-8601
}

/** One tool invocation inside an assistant turn. */
export interface ToolCallRecord {
  id: string;
  name: AgentToolName;
  input: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  timestamp: string; // ISO-8601
}

/** A complete turn (request + response) stored for conversation history display. */
export interface ConversationTurn {
  turn_index: number;
  user_message: string;
  assistant_message: string;
  tool_calls: ToolCallRecord[];
  created_at: string;
}

// ── Agent Streaming Events ────────────────────────────────────────────────────

/** Server-sent event payload streamed during POST /api/agent/message */
export interface AgentStreamEvent {
  type:
    | 'text_delta'       // incremental text token
    | 'tool_call_start'  // agent is about to invoke a tool
    | 'tool_call_result' // tool returned a result
    | 'message_complete' // full assistant turn is done
    | 'error';           // unrecoverable error
  content?: string;
  tool_call?: ToolCallRecord;
  message?: AgentMessage; // populated on message_complete
  error?: string;
}

/** Body of POST /api/agent/message */
export interface AgentMessageRequest {
  message: string;
  /** Omit to start a new session. */
  session_id?: string;
}

// ── GitHub / Repo ─────────────────────────────────────────────────────────────

/** A single entry from the GitHub Trees / Contents API. */
export interface RepoFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  sha: string;
}

/** Full file contents returned by the agent read_file tool. */
export interface FileContent {
  path: string;
  content: string;
  sha: string;
  size: number;
  encoding: 'utf-8' | 'base64';
}

/** Condensed representation of a single git commit. */
export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  author_email?: string;
  date: string; // ISO-8601
  files_changed: string[];
  additions?: number;
  deletions?: number;
  html_url?: string;
}

/** Diff between two refs (branch, commit, tag). */
export interface DiffResult {
  base: string;
  head: string;
  files: DiffFile[];
  total_additions: number;
  total_deletions: number;
  has_conflicts: boolean;
}

/** Per-file diff entry inside DiffResult. */
export interface DiffFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'unchanged';
  additions: number;
  deletions: number;
  /** Unified diff patch string (may be absent for binary files). */
  patch?: string;
  /** Previous filename when status is "renamed". */
  previous_filename?: string;
}

/** Result of a pre-merge conflict check. */
export interface ConflictInfo {
  has_conflicts: boolean;
  conflicting_files: string[];
  clean_files: string[];
  message: string;
}

/** Result of an actual merge operation. */
export interface MergeResult {
  success: boolean;
  sha?: string;
  message: string;
}

/** Condensed pull request. */
export interface PRInfo {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  head_branch: string;
  base_branch: string;
  author: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  draft: boolean;
  mergeable?: boolean | null;
  comments: number;
  review_comments: number;
}

/** Input to create a pull request. */
export interface CreatePRInput {
  title: string;
  body?: string;
  head: string;
  base?: string; // defaults to the repo's default branch
  draft?: boolean;
}

/** A GitHub issue. */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  author: string;
  labels: string[];
  assignees: string[];
  created_at: string;
  html_url: string;
}

/** Input to create an issue. */
export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

// ── Collaborator Activity ─────────────────────────────────────────────────────

/** Live snapshot of what a single collaborator is doing in the shared repo. */
export interface CollaboratorActivity {
  username: string;
  display_name: string;
  avatar_url?: string;
  role: string;
  /** The branch this collaborator most recently pushed to. */
  branch: string;
  recent_commits: CommitInfo[];
  open_prs: PRInfo[];
  recently_modified_files: string[];
  is_active: boolean;
  last_active_at?: string; // ISO-8601
}

// ── WebSocket Events ──────────────────────────────────────────────────────────

/** All WebSocket event discriminant strings. */
export type WSEventType =
  | 'collaborator_push'    // a collaborator pushed commits to a branch
  | 'collaborator_action'  // a collaborator performed a discrete action (create PR, merge, etc.)
  | 'collaborator_merge'   // a PR was merged
  | 'collaborator_status'  // a collaborator came online / went offline
  | 'agent_activity'       // the AI agent started or finished a tool call
  | 'conflict_detected'    // a potential merge conflict was detected
  | 'ping';                // heartbeat

/** Envelope for all WebSocket messages sent to the browser. */
export interface WSEvent<T extends WSEventPayload = WSEventPayload> {
  type: WSEventType;
  payload: T;
  timestamp: string; // ISO-8601
}

export type WSEventPayload =
  | CollaboratorPushEvent
  | CollaboratorActionEvent
  | CollaboratorMergeEvent
  | CollaboratorStatusEvent
  | AgentActivityEvent
  | ConflictDetectedEvent
  | PingEvent;

/** Emitted when GitHub sends a push webhook. */
export interface CollaboratorPushEvent {
  user: string;
  avatar_url?: string;
  branch: string;
  commits: CommitInfo[];
  compare_url: string;
}

/** Generic action event (e.g. "opened a PR", "commented", "created a branch"). */
export interface CollaboratorActionEvent {
  user: string;
  avatar_url?: string;
  action: string;
  resource_type: 'pr' | 'issue' | 'branch' | 'commit' | 'file';
  resource_title?: string;
  resource_url?: string;
  file?: string;
  commit_message?: string;
}

/** Emitted when a PR is merged. */
export interface CollaboratorMergeEvent {
  user: string;
  avatar_url?: string;
  pr_number?: number;
  pr_title?: string;
  merged_at: string; // ISO-8601
  commit_message: string;
  files_changed: string[];
  base_branch: string;
}

/** Presence change for a collaborator. */
export interface CollaboratorStatusEvent {
  user: string;
  avatar_url?: string;
  is_active: boolean;
  last_active_at?: string;
}

/** Emitted when the AI agent starts or finishes a tool invocation. */
export interface AgentActivityEvent {
  session_id: string;
  tool_call: ToolCallRecord;
}

/** Emitted when the server detects that a collaborator's branch conflicts with main. */
export interface ConflictDetectedEvent {
  branch: string;
  user: string;
  conflicting_files: string[];
  message: string;
}

/** Keep-alive heartbeat. */
export interface PingEvent {
  server_time: string;
}

// ── Agent Tool Definitions ────────────────────────────────────────────────────

export type AgentToolName =
  | 'read_file'
  | 'write_file'
  | 'delete_file'
  | 'rename_file'
  | 'list_files'
  | 'search_code'
  | 'get_diff'
  | 'get_commit_log'
  | 'check_conflicts'
  | 'merge_to_main'
  | 'create_pr'
  | 'get_pr_list'
  | 'get_pr'
  | 'comment_on_pr'
  | 'get_collaborator_activity'
  | 'create_issue'
  | 'get_issues'
  | 'create_branch'
  | 'list_branches';

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  input_schema: Record<string, unknown>;
}

// ── API Request / Response Types ──────────────────────────────────────────────

// --- Auth ---

export interface GetMeResponse {
  user: SessionUser;
}

// --- Sessions ---

export interface ListSessionsResponse {
  sessions: Session[];
}

export interface CreateSessionResponse {
  session: Session;
}

export interface GetSessionMessagesResponse {
  messages: AgentMessage[];
}

// --- Workspace ---

export interface GetWorkspaceResponse {
  settings: WorkspaceSettings | null;
}

export interface SaveWorkspaceResponse {
  settings: WorkspaceSettings;
}

// --- Repo ---

export interface ListFilesRequest {
  path?: string;
  ref?: string;
}

export interface ListFilesResponse {
  files: RepoFile[];
  path: string;
  ref: string;
}

export interface ReadFileRequest {
  path: string;
  ref?: string;
}

export interface ReadFileResponse {
  file: FileContent;
}

export interface WriteFileRequest {
  path: string;
  content: string;
  message: string;
  branch?: string;
  sha?: string; // required when updating an existing file
}

export interface WriteFileResponse {
  path: string;
  sha: string;
  commit_sha: string;
  message: string;
}

export interface DeleteFileRequest {
  path: string;
  message: string;
  branch?: string;
  sha: string;
}

export interface DeleteFileResponse {
  success: boolean;
  commit_sha: string;
}

export interface GetDiffRequest {
  base: string;
  head: string;
}

export interface GetDiffResponse {
  diff: DiffResult;
}

export interface GetCommitLogRequest {
  branch?: string;
  path?: string;
  per_page?: number;
}

export interface GetCommitLogResponse {
  commits: CommitInfo[];
}

export interface CheckConflictsRequest {
  head_branch: string;
  base_branch?: string;
}

export interface CheckConflictsResponse {
  result: ConflictInfo;
}

export interface MergeRequest {
  head_branch: string;
  base_branch?: string;
  commit_message?: string;
  merge_method?: 'merge' | 'squash' | 'rebase';
}

export interface MergeResponse {
  result: MergeResult;
}

// --- Pull Requests ---

export interface ListPRsRequest {
  state?: 'open' | 'closed' | 'all';
  per_page?: number;
}

export interface ListPRsResponse {
  pull_requests: PRInfo[];
}

export interface GetPRResponse {
  pull_request: PRInfo;
}

export interface CreatePRResponse {
  pull_request: PRInfo;
}

export interface CommentOnPRRequest {
  body: string;
}

export interface CommentOnPRResponse {
  comment_id: number;
  html_url: string;
}

// --- Issues ---

export interface ListIssuesRequest {
  state?: 'open' | 'closed' | 'all';
  per_page?: number;
}

export interface ListIssuesResponse {
  issues: GitHubIssue[];
}

export interface CreateIssueResponse {
  issue: GitHubIssue;
}

// --- Collaborators ---

export interface ListCollaboratorsResponse {
  collaborators: CollaboratorActivity[];
}

// --- Search ---

export interface SearchCodeRequest {
  query: string;
  path?: string;
  extension?: string;
}

export interface SearchCodeResult {
  path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

export interface SearchCodeResponse {
  results: SearchCodeResult[];
  total: number;
  query: string;
}

// --- Generic API error shape ---

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}
