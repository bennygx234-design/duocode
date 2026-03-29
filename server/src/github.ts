import { Octokit } from '@octokit/rest';
import type { UserRow } from './db';
import { decryptToken } from './db';
import type {
  RepoFile,
  FileContent,
  CommitInfo,
  DiffResult,
  DiffFile,
  PRInfo,
} from 'duocode-shared';

// ---------------------------------------------------------------------------
// Octokit factory
// ---------------------------------------------------------------------------

export function createOctokitForUser(user: UserRow): Octokit {
  const token = decryptToken(user.access_token_encrypted);
  return new Octokit({ auth: token });
}

export function createOctokitFromToken(token: string): Octokit {
  return new Octokit({ auth: token });
}

/** Alias for createOctokitForUser — used by agent route code */
export const getOctokitForUser = createOctokitForUser;

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------

export async function getFileTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  treePath = '',
  ref?: string
): Promise<RepoFile[]> {
  // Use the git trees API for recursive listing when no path is specified
  if (!treePath) {
    const { data: refData } = await octokit.rest.repos.get({ owner, repo });
    const branch = ref ?? refData.default_branch;

    const { data: treeData } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: '1',
    });

    return (treeData.tree ?? [])
      .filter((item) => item.path && item.type)
      .map((item) => ({
        name: item.path!.split('/').pop()!,
        path: item.path!,
        type: item.type === 'blob' ? 'file' : 'dir',
        size: item.size,
        sha: item.sha ?? '',
      }));
  }

  // Otherwise list contents at a specific path
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: treePath,
    ...(ref ? { ref } : {}),
  });

  const items = Array.isArray(data) ? data : [data];
  return items.map((item) => ({
    name: item.name,
    path: item.path,
    type: item.type === 'file' ? 'file' : 'dir',
    size: (item as { size?: number }).size,
    sha: item.sha,
  }));
}

// ---------------------------------------------------------------------------
// File content
// ---------------------------------------------------------------------------

export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  filePath: string,
  ref?: string
): Promise<FileContent> {
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: filePath,
    ...(ref ? { ref } : {}),
  });

  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`Path "${filePath}" is not a file`);
  }

  const fileData = data as {
    path: string;
    content: string;
    sha: string;
    size: number;
    encoding: string;
  };

  return {
    path: fileData.path,
    content:
      fileData.encoding === 'base64'
        ? Buffer.from(fileData.content, 'base64').toString('utf8')
        : fileData.content,
    sha: fileData.sha,
    size: fileData.size,
    encoding: 'utf-8' as const,
  };
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export async function getCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch = 'main',
  n = 10
): Promise<CommitInfo[]> {
  const { data } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    sha: branch,
    per_page: n,
  });

  return data.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message,
    author: commit.commit.author?.name ?? commit.author?.login ?? 'unknown',
    date: commit.commit.author?.date ?? '',
    files_changed: [], // detailed files require an extra API call per commit; omit for list view
  }));
}

// ---------------------------------------------------------------------------
// Diff between two refs
// ---------------------------------------------------------------------------

export async function getDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<DiffResult> {
  const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${base}...${head}`,
  });

  const files: DiffFile[] = (data.files ?? []).map((f) => ({
    filename: f.filename,
    status: (f.status as DiffFile['status']) ?? 'modified',
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));

  return {
    base,
    head,
    files,
    total_additions: data.files?.reduce((s, f) => s + f.additions, 0) ?? 0,
    total_deletions: data.files?.reduce((s, f) => s + f.deletions, 0) ?? 0,
    has_conflicts: false, // GitHub compare API doesn't surface conflicts directly
  };
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

export async function listPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open'
): Promise<PRInfo[]> {
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state,
    per_page: 30,
    sort: 'updated',
    direction: 'desc',
  });

  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    state: pr.merged_at ? 'merged' : (pr.state as 'open' | 'closed'),
    head_branch: pr.head.ref,
    base_branch: pr.base.ref,
    author: pr.user?.login ?? 'unknown',
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    html_url: pr.html_url,
    draft: pr.draft ?? false,
    mergeable: (pr as unknown as { mergeable?: boolean | null }).mergeable ?? null,
    comments: (pr as unknown as { comments?: number }).comments ?? 0,
    review_comments: (pr as unknown as { review_comments?: number }).review_comments ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Branch management
// ---------------------------------------------------------------------------

export async function createBranchIfNotExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  fromBranch = 'main'
): Promise<{ created: boolean; sha: string }> {
  // Check if branch already exists
  try {
    const { data } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
    });
    return { created: false, sha: data.object.sha };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
  }

  // Get SHA of source branch
  const { data: sourceRef } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${fromBranch}`,
  });

  const sha = sourceRef.object.sha;

  // Create new branch
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha,
  });

  return { created: true, sha };
}

// ---------------------------------------------------------------------------
// Commits with file details (single commit)
// ---------------------------------------------------------------------------

export async function getCommitDetail(
  octokit: Octokit,
  owner: string,
  repo: string,
  commitSha: string
): Promise<CommitInfo> {
  const { data } = await octokit.rest.repos.getCommit({
    owner,
    repo,
    ref: commitSha,
  });

  return {
    sha: data.sha,
    message: data.commit.message,
    author: data.commit.author?.name ?? data.author?.login ?? 'unknown',
    date: data.commit.author?.date ?? '',
    files_changed: (data.files ?? []).map((f) => f.filename),
  };
}

// ---------------------------------------------------------------------------
// Recently modified files (past N hours, across all branches in a repo)
// ---------------------------------------------------------------------------

export async function getRecentlyModifiedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: Date,
  branch = 'main'
): Promise<string[]> {
  const { data: commits } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    sha: branch,
    since: since.toISOString(),
    per_page: 20,
  });

  const fileSet = new Set<string>();
  for (const commit of commits.slice(0, 10)) {
    try {
      const { data } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: commit.sha,
      });
      (data.files ?? []).forEach((f) => fileSet.add(f.filename));
    } catch {
      // best-effort
    }
  }

  return Array.from(fileSet);
}
