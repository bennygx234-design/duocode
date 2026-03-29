import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSettings } from '../db';
import {
  createOctokitForUser,
  getFileTree,
  getFileContent,
  getCommits,
  getDiff,
} from '../github';

const router = Router();

// All repo routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Resolve repo owner/name from settings or query params
// ---------------------------------------------------------------------------

function resolveRepo(
  req: Request,
  res: Response
): { owner: string; repo: string } | null {
  const userId = req.user!.id;
  const settings = getSettings(userId);

  const owner =
    (req.query.owner as string | undefined) ??
    settings?.repo_owner ??
    null;
  const repo =
    (req.query.repo as string | undefined) ??
    settings?.repo_name ??
    null;

  if (!owner || !repo) {
    res.status(400).json({
      error: 'No repository configured',
      message:
        'Set repo_owner and repo_name in workspace settings or pass them as query params.',
    });
    return null;
  }

  return { owner, repo };
}

// ---------------------------------------------------------------------------
// GET /api/repo/tree?path=&ref=
// ---------------------------------------------------------------------------

router.get('/tree', async (req: Request, res: Response): Promise<void> => {
  const repoInfo = resolveRepo(req, res);
  if (!repoInfo) return;

  const { owner, repo } = repoInfo;
  const treePath = (req.query.path as string | undefined) ?? '';
  const ref = req.query.ref as string | undefined;

  try {
    const octokit = createOctokitForUser(req.user!);
    const tree = await getFileTree(octokit, owner, repo, treePath, ref);
    res.json({ tree, owner, repo, path: treePath });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = (err as Error).message ?? 'Unknown error';
    res.status(status).json({ error: 'Failed to fetch file tree', message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/repo/file?path=<filepath>&ref=
// ---------------------------------------------------------------------------

router.get('/file', async (req: Request, res: Response): Promise<void> => {
  const repoInfo = resolveRepo(req, res);
  if (!repoInfo) return;

  const { owner, repo } = repoInfo;
  const filePath = req.query.path as string | undefined;
  const ref = req.query.ref as string | undefined;

  if (!filePath) {
    res.status(400).json({ error: 'Missing required query param: path' });
    return;
  }

  try {
    const octokit = createOctokitForUser(req.user!);
    const content = await getFileContent(octokit, owner, repo, filePath, ref);
    res.json(content);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = (err as Error).message ?? 'Unknown error';
    res.status(status).json({ error: 'Failed to fetch file content', message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/repo/commits?branch=&n=
// ---------------------------------------------------------------------------

router.get('/commits', async (req: Request, res: Response): Promise<void> => {
  const repoInfo = resolveRepo(req, res);
  if (!repoInfo) return;

  const { owner, repo } = repoInfo;
  const branch = (req.query.branch as string | undefined) ?? 'main';
  const n = Math.min(parseInt((req.query.n as string | undefined) ?? '10', 10), 100);

  try {
    const octokit = createOctokitForUser(req.user!);
    const commits = await getCommits(octokit, owner, repo, branch, n);
    res.json({ commits, branch, n });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = (err as Error).message ?? 'Unknown error';
    res.status(status).json({ error: 'Failed to fetch commits', message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/repo/diff?base=<ref>&head=<ref>
// ---------------------------------------------------------------------------

router.get('/diff', async (req: Request, res: Response): Promise<void> => {
  const repoInfo = resolveRepo(req, res);
  if (!repoInfo) return;

  const { owner, repo } = repoInfo;
  const base = req.query.base as string | undefined;
  const head = req.query.head as string | undefined;

  if (!base || !head) {
    res.status(400).json({ error: 'Missing required query params: base, head' });
    return;
  }

  try {
    const octokit = createOctokitForUser(req.user!);
    const diff = await getDiff(octokit, owner, repo, base, head);
    res.json(diff);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = (err as Error).message ?? 'Unknown error';
    res.status(status).json({ error: 'Failed to fetch diff', message });
  }
});

export default router;
