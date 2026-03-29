import { Octokit } from '@octokit/rest';
import type { Database } from '../db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeBase64(content: string): string {
  return Buffer.from(content, 'utf-8').toString('base64');
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export async function read_file(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const response = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: branch,
  });

  const data = response.data;
  if (Array.isArray(data)) {
    throw new Error(`Path "${path}" is a directory, not a file.`);
  }
  if (data.type !== 'file') {
    throw new Error(`Path "${path}" is not a file (type: ${data.type}).`);
  }
  if (!('content' in data)) {
    throw new Error(`No content returned for "${path}".`);
  }

  return decodeBase64((data.content as string).replace(/\n/g, ''));
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

export async function write_file(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  commit_message: string,
): Promise<{ sha: string; html_url: string }> {
  // Try to get existing file SHA (needed for updates)
  let existingSha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });
    const d = existing.data;
    if (!Array.isArray(d) && 'sha' in d) {
      existingSha = d.sha;
    }
  } catch {
    // File doesn't exist yet — create it
  }

  const result = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: commit_message,
    content: encodeBase64(content),
    branch,
    ...(existingSha ? { sha: existingSha } : {}),
  });

  return {
    sha: result.data.commit.sha ?? '',
    html_url: result.data.content?.html_url ?? '',
  };
}

// ---------------------------------------------------------------------------
// list_files
// ---------------------------------------------------------------------------

export interface ListedFile {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size?: number;
  sha: string;
}

export async function list_files(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string = '',
  branch: string = 'main',
): Promise<ListedFile[]> {
  const response = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: branch,
  });

  const data = response.data;
  if (!Array.isArray(data)) {
    throw new Error(`Path "${path}" is a file, not a directory.`);
  }

  return data.map((item) => ({
    name: item.name,
    path: item.path,
    type: item.type as ListedFile['type'],
    size: item.size,
    sha: item.sha,
  }));
}

// ---------------------------------------------------------------------------
// search_code
// ---------------------------------------------------------------------------

export interface SearchMatch {
  file_path: string;
  repository: string;
  html_url: string;
  text_matches: Array<{
    fragment: string;
    line_number?: number;
  }>;
}

export async function search_code(
  octokit: Octokit,
  owner: string,
  repo: string,
  query: string,
): Promise<SearchMatch[]> {
  const fullQuery = `${query} repo:${owner}/${repo}`;

  const response = await octokit.search.code({
    q: fullQuery,
    per_page: 30,
  });

  return response.data.items.map((item) => ({
    file_path: item.path,
    repository: item.repository.full_name,
    html_url: item.html_url,
    text_matches: ((item as Record<string, unknown>).text_matches as Array<{
      fragment?: string;
      matches?: Array<{ indices: number[] }>;
    }> | undefined)?.map((tm) => ({
      fragment: tm.fragment ?? '',
    })) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// check_conflicts
// ---------------------------------------------------------------------------

export interface ConflictCheckResult {
  has_conflicts: boolean;
  conflicting_files: string[];
  clean_files: string[];
  message: string;
}

export async function check_conflicts(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  base: string = 'main',
): Promise<ConflictCheckResult> {
  // Use GitHub compare API to get files changed in branch vs base
  const comparison = await octokit.repos.compareCommits({
    owner,
    repo,
    base,
    head: branch,
  });

  const changedFiles = comparison.data.files ?? [];

  // GitHub compare does not surface merge conflicts directly —
  // we check for files modified on both sides by doing a reverse compare
  const reverseComparison = await octokit.repos.compareCommits({
    owner,
    repo,
    base: branch,
    head: base,
  });

  const baseChangedFiles = new Set(
    (reverseComparison.data.files ?? []).map((f) => f.filename),
  );

  const conflicting: string[] = [];
  const clean: string[] = [];

  for (const file of changedFiles) {
    if (baseChangedFiles.has(file.filename)) {
      conflicting.push(file.filename);
    } else {
      clean.push(file.filename);
    }
  }

  return {
    has_conflicts: conflicting.length > 0,
    conflicting_files: conflicting,
    clean_files: clean,
    message:
      conflicting.length > 0
        ? `Found ${conflicting.length} potentially conflicting file(s): ${conflicting.join(', ')}`
        : 'No conflicts detected. Branch is safe to merge.',
  };
}

// ---------------------------------------------------------------------------
// merge_to_main
// ---------------------------------------------------------------------------

export interface MergeResult {
  success: boolean;
  sha: string;
  message: string;
}

export async function merge_to_main(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  commit_message: string,
): Promise<MergeResult> {
  // Safety check — never force-merge if conflicts exist
  const conflictCheck = await check_conflicts(octokit, owner, repo, branch, 'main');
  if (conflictCheck.has_conflicts) {
    throw new Error(
      `Merge aborted: conflicts detected in files: ${conflictCheck.conflicting_files.join(', ')}. ` +
        'Resolve conflicts before merging.',
    );
  }

  const result = await octokit.repos.merge({
    owner,
    repo,
    base: 'main',
    head: branch,
    commit_message,
  });

  if ((result.status as number) === 204) {
    return {
      success: true,
      sha: '',
      message: 'Branch is already up to date with main — nothing to merge.',
    };
  }

  return {
    success: true,
    sha: result.data.sha ?? '',
    message: `Successfully merged "${branch}" into main. Merge commit: ${result.data.sha}`,
  };
}

// ---------------------------------------------------------------------------
// create_pr
// ---------------------------------------------------------------------------

export interface PRResult {
  number: number;
  html_url: string;
  title: string;
  state: string;
}

export async function create_pr(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  title: string,
  body: string,
  base_branch: string = 'main',
): Promise<PRResult> {
  const result = await octokit.pulls.create({
    owner,
    repo,
    title,
    body,
    head: branch,
    base: base_branch,
  });

  return {
    number: result.data.number,
    html_url: result.data.html_url,
    title: result.data.title,
    state: result.data.state,
  };
}

// ---------------------------------------------------------------------------
// get_pr_list
// ---------------------------------------------------------------------------

export interface PRSummary {
  number: number;
  title: string;
  author: string;
  head_branch: string;
  base_branch: string;
  state: string;
  created_at: string;
  html_url: string;
}

export async function get_pr_list(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<PRSummary[]> {
  const result = await octokit.pulls.list({
    owner,
    repo,
    state: 'open',
    per_page: 50,
  });

  return result.data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? 'unknown',
    head_branch: pr.head.ref,
    base_branch: pr.base.ref,
    state: pr.state,
    created_at: pr.created_at,
    html_url: pr.html_url,
  }));
}

// ---------------------------------------------------------------------------
// comment_on_pr
// ---------------------------------------------------------------------------

export async function comment_on_pr(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr_number: number,
  comment: string,
): Promise<{ id: number; html_url: string }> {
  const result = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pr_number,
    body: comment,
  });

  return {
    id: result.data.id,
    html_url: result.data.html_url,
  };
}

// ---------------------------------------------------------------------------
// get_diff
// ---------------------------------------------------------------------------

export interface DiffSummary {
  base: string;
  head: string;
  ahead_by: number;
  behind_by: number;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
  total_additions: number;
  total_deletions: number;
}

export async function get_diff(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<DiffSummary> {
  const result = await octokit.repos.compareCommits({
    owner,
    repo,
    base,
    head,
  });

  const files = (result.data.files ?? []).map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));

  const total_additions = files.reduce((acc, f) => acc + f.additions, 0);
  const total_deletions = files.reduce((acc, f) => acc + f.deletions, 0);

  return {
    base,
    head,
    ahead_by: result.data.ahead_by,
    behind_by: result.data.behind_by,
    files,
    total_additions,
    total_deletions,
  };
}

// ---------------------------------------------------------------------------
// get_commit_log
// ---------------------------------------------------------------------------

export interface CommitEntry {
  sha: string;
  message: string;
  author: string;
  date: string;
  html_url: string;
}

export async function get_commit_log(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  n: number = 10,
): Promise<CommitEntry[]> {
  const result = await octokit.repos.listCommits({
    owner,
    repo,
    sha: branch,
    per_page: Math.min(n, 100),
  });

  return result.data.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split('\n')[0], // first line only
    author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
    date: c.commit.author?.date ?? '',
    html_url: c.html_url,
  }));
}

// ---------------------------------------------------------------------------
// get_collaborator_activity
// ---------------------------------------------------------------------------

export async function get_collaborator_activity(
  db: Database,
  currentUserId: number,
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string> {
  // Find the collaborator (a different user sharing the same repo settings)
  const collaborator = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, ws.agent_role
       FROM users u
       JOIN workspace_settings ws ON ws.user_id = u.id
       WHERE u.id != ?
         AND ws.repo_owner = ?
         AND ws.repo_name = ?
       LIMIT 1`,
    )
    .get(currentUserId, owner, repo) as
    | { id: number; username: string; display_name: string; agent_role: string }
    | undefined;

  if (!collaborator) {
    return 'No collaborator found sharing this repository.';
  }

  const collaboratorBranch = `agent-${collaborator.username}`;

  // Last 5 commits on their branch
  let recentCommits: CommitEntry[] = [];
  try {
    recentCommits = await get_commit_log(octokit, owner, repo, collaboratorBranch, 5);
  } catch {
    // Branch might not exist yet
  }

  // Open PRs authored by collaborator
  let openPRs: PRSummary[] = [];
  try {
    const allPRs = await get_pr_list(octokit, owner, repo);
    openPRs = allPRs.filter((pr) => pr.author === collaborator.username);
  } catch {
    // Ignore
  }

  // Files modified in last 24 hours on their branch
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentFiles = new Set<string>();
  try {
    const commits = await octokit.repos.listCommits({
      owner,
      repo,
      sha: collaboratorBranch,
      since: oneDayAgo,
      per_page: 20,
    });

    for (const commit of commits.data) {
      try {
        const detail = await octokit.repos.getCommit({
          owner,
          repo,
          ref: commit.sha,
        });
        for (const file of detail.data.files ?? []) {
          recentFiles.add(file.filename);
        }
      } catch {
        // Skip individual commit errors
      }
    }
  } catch {
    // Branch might not exist
  }

  // Format output
  const lines: string[] = [
    `=== Collaborator Activity: ${collaborator.display_name} (@${collaborator.username}) ===`,
    `Role: ${collaborator.agent_role || 'Developer'}`,
    `Branch: ${collaboratorBranch}`,
    '',
  ];

  lines.push('--- Recent Commits (last 5) ---');
  if (recentCommits.length === 0) {
    lines.push('  No commits found.');
  } else {
    for (const c of recentCommits) {
      lines.push(`  [${c.sha.slice(0, 7)}] ${c.date.slice(0, 10)} - ${c.message} (${c.author})`);
    }
  }

  lines.push('');
  lines.push('--- Open Pull Requests ---');
  if (openPRs.length === 0) {
    lines.push('  No open PRs.');
  } else {
    for (const pr of openPRs) {
      lines.push(`  #${pr.number}: "${pr.title}" (${pr.head_branch} -> ${pr.base_branch})`);
    }
  }

  lines.push('');
  lines.push('--- Files Modified in Last 24h ---');
  if (recentFiles.size === 0) {
    lines.push('  No files modified in the last 24 hours.');
  } else {
    for (const f of recentFiles) {
      lines.push(`  - ${f}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// create_issue
// ---------------------------------------------------------------------------

export interface IssueResult {
  number: number;
  html_url: string;
  title: string;
}

export async function create_issue(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
): Promise<IssueResult> {
  const result = await octokit.issues.create({
    owner,
    repo,
    title,
    body,
  });

  return {
    number: result.data.number,
    html_url: result.data.html_url,
    title: result.data.title,
  };
}

// ---------------------------------------------------------------------------
// get_issues
// ---------------------------------------------------------------------------

export interface IssueSummary {
  number: number;
  title: string;
  author: string;
  state: string;
  created_at: string;
  html_url: string;
  body: string;
}

export async function get_issues(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<IssueSummary[]> {
  const result = await octokit.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    per_page: 50,
  });

  // Filter out pull requests (GitHub returns PRs in issues API)
  return result.data
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      author: issue.user?.login ?? 'unknown',
      state: issue.state,
      created_at: issue.created_at,
      html_url: issue.html_url,
      body: issue.body ?? '',
    }));
}

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

export async function delete_file(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  commit_message: string,
): Promise<{ sha: string }> {
  // Must get current SHA to delete
  const existing = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: branch,
  });

  const d = existing.data;
  if (Array.isArray(d) || !('sha' in d)) {
    throw new Error(`Cannot delete "${path}": path is a directory or SHA unavailable.`);
  }

  const result = await octokit.repos.deleteFile({
    owner,
    repo,
    path,
    message: commit_message,
    sha: d.sha,
    branch,
  });

  return { sha: result.data.commit.sha ?? '' };
}

// ---------------------------------------------------------------------------
// rename_file
// ---------------------------------------------------------------------------

export async function rename_file(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  old_path: string,
  new_path: string,
  commit_message: string,
): Promise<{ old_path: string; new_path: string }> {
  // Read existing content
  const content = await read_file(octokit, owner, repo, branch, old_path);

  // Write to new path
  await write_file(
    octokit,
    owner,
    repo,
    branch,
    new_path,
    content,
    `${commit_message} (copy to ${new_path})`,
  );

  // Delete old path
  await delete_file(
    octokit,
    owner,
    repo,
    branch,
    old_path,
    `${commit_message} (delete ${old_path})`,
  );

  return { old_path, new_path };
}
