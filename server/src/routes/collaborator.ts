import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getAllUsers,
  getSettings,
  getAgentSession,
} from '../db';
import {
  createOctokitForUser,
  getCommits,
  listPRs,
  getRecentlyModifiedFiles,
} from '../github';
import type { CollaboratorActivity } from 'duocode-shared';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/collaborator/activity
//
// Finds the *other* registered user in the DB (the collaborator), then uses
// the requesting user's GitHub token (as they must share the same repo) to
// fetch that collaborator's recent GitHub activity.
// ---------------------------------------------------------------------------

router.get('/activity', async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.user!.id;

  // Find the collaborator: the first other user in the DB
  const allUsers = getAllUsers();
  const collaboratorUser = allUsers.find((u) => u.id !== currentUserId);

  if (!collaboratorUser) {
    res.status(404).json({
      error: 'No collaborator found',
      message: 'There is no other user registered in this DuoCode workspace yet.',
    });
    return;
  }

  // Resolve repo from current user's settings
  const settings = getSettings(currentUserId);
  const owner = settings?.repo_owner;
  const repo = settings?.repo_name;

  if (!owner || !repo) {
    res.status(400).json({
      error: 'No repository configured',
      message: 'Configure repo_owner and repo_name in workspace settings first.',
    });
    return;
  }

  const collaboratorSettings = getSettings(collaboratorUser.id);
  const collaboratorRole = collaboratorSettings?.role_description ?? 'Collaborator';

  // Determine if the collaborator has been active in the last 5 minutes
  const sessionRow = getAgentSession(collaboratorUser.id);
  const isActive = sessionRow
    ? Date.now() - new Date(sessionRow.last_active).getTime() < 5 * 60 * 1000
    : false;

  try {
    // Use the requesting user's Octokit to fetch the repo activity
    const octokit = createOctokitForUser(req.user!);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Fetch in parallel
    const [allCommits, openPRs, recentFiles] = await Promise.all([
      getCommits(octokit, owner, repo, 'main', 20).catch(() => []),
      listPRs(octokit, owner, repo, 'open').catch(() => []),
      getRecentlyModifiedFiles(octokit, owner, repo, since24h, 'main').catch(() => []),
    ]);

    // Filter commits authored by the collaborator's GitHub login
    const collaboratorLogin = collaboratorUser.login;
    const collaboratorCommits = allCommits
      .filter(
        (c) =>
          c.author.toLowerCase() === collaboratorLogin.toLowerCase()
      )
      .slice(0, 5);

    // Filter PRs authored by the collaborator
    const collaboratorPRs = openPRs.filter(
      (pr) => pr.author.toLowerCase() === collaboratorLogin.toLowerCase()
    );

    // Determine the collaborator's "current branch" from their most recent PR
    const currentBranch =
      collaboratorPRs[0]?.head_branch ?? collaboratorSettings?.default_branch_behavior ?? 'main';

    const activity: CollaboratorActivity = {
      username: collaboratorUser.login,
      display_name: collaboratorUser.name ?? collaboratorUser.login,
      role: collaboratorRole,
      branch: currentBranch,
      recent_commits: collaboratorCommits,
      open_prs: collaboratorPRs,
      recently_modified_files: recentFiles.slice(0, 20),
      is_active: isActive,
      last_active_at: sessionRow?.last_active,
    };

    res.json(activity);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = (err as Error).message ?? 'Unknown error';
    res.status(status).json({ error: 'Failed to fetch collaborator activity', message });
  }
});

export default router;
