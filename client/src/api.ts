import type {
  SessionUser,
  WorkspaceSettings,
  WorkspaceSettingsInput,
  AgentMessage as ChatMessage,
  AgentMessageRequest,
  RepoFile,
  FileContent,
  CommitInfo,
  PRInfo as PullRequest,
  CollaboratorActivity,
  DiffResult,
  CheckConflictsResponse as ConflictCheckResult,
  MergeResult,
} from 'duocode-shared';

export type { SessionUser, WorkspaceSettings };

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function getMe(): Promise<SessionUser> {
  return request<{ user: SessionUser }>('/auth/me').then((r) => r.user);
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' });
}

// ── Workspace ─────────────────────────────────────────────────────────────────

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>('/workspace/settings');
}

export function createWorkspaceSettings(data: WorkspaceSettingsInput): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>('/workspace/settings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateWorkspaceSettings(data: Partial<WorkspaceSettingsInput>): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>('/workspace/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ── Chat / Messages ───────────────────────────────────────────────────────────

export function getChatHistory(sessionId?: string): Promise<ChatMessage[]> {
  const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  return request<ChatMessage[]>(`/agent/history${qs}`);
}

export function sendAgentMessage(data: AgentMessageRequest): Promise<Response> {
  return fetch(`${BASE}/agent/message`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Repo ──────────────────────────────────────────────────────────────────────

export function getRepoTree(path?: string): Promise<RepoFile[]> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return request<RepoFile[]>(`/repo/tree${qs}`);
}

export function getFileContent(filePath: string): Promise<FileContent> {
  return request<FileContent>(`/repo/file?path=${encodeURIComponent(filePath)}`);
}

export interface CommitStatus {
  branch: string;
  ahead: number;
  behind: number;
  base: string;
  last_merge_status?: 'clean' | 'conflict' | null;
  open_prs: PullRequest[];
}

export function getCommitStatus(): Promise<CommitStatus> {
  return request<CommitStatus>('/repo/commits');
}

export function getCommitLog(branch?: string, limit?: number): Promise<CommitInfo[]> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString() ? `?${params}` : '';
  return request<CommitInfo[]>(`/repo/log${qs}`);
}

export function getDiff(base: string, head: string): Promise<DiffResult> {
  return request<DiffResult>(`/repo/diff?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
}

export function checkConflicts(base: string, head: string): Promise<ConflictCheckResult> {
  return request<ConflictCheckResult>(`/repo/conflicts?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
}

export function mergeToMain(head: string, message?: string): Promise<MergeResult> {
  return request<MergeResult>('/repo/merge', {
    method: 'POST',
    body: JSON.stringify({ head, message }),
  });
}

export function getPullRequests(): Promise<PullRequest[]> {
  return request<PullRequest[]>('/repo/prs');
}

// ── Collaborator ──────────────────────────────────────────────────────────────

export function getCollaboratorActivity(): Promise<CollaboratorActivity> {
  return request<CollaboratorActivity>('/collaborator/activity');
}
