import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { requireAuth } from '../middleware/auth';
import { getDb, getWorkspaceSettings } from '../db';
import { getOctokitForUser } from '../github';
import { broadcastToCollaborator } from '../websocket';
import { runAgentTurn, BroadcastEvent } from '../agent/runner';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a single SSE frame to the response */
function sseWrite(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Ensure the agent branch (agent-{username}) exists.
 * If it doesn't, creates it from main (or the repo's default branch).
 */
async function ensureAgentBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string,
): Promise<string> {
  const branchName = `agent-${username}`;

  // Check if branch already exists
  try {
    await octokit.repos.getBranch({ owner, repo, branch: branchName });
    return branchName; // Already exists
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err; // Unexpected error
  }

  // Branch doesn't exist — get the SHA of main (fall back to default branch)
  let baseSha: string;
  try {
    const mainRef = await octokit.git.getRef({
      owner,
      repo,
      ref: 'heads/main',
    });
    baseSha = mainRef.data.object.sha;
  } catch {
    // Try to find the default branch
    const repoInfo = await octokit.repos.get({ owner, repo });
    const defaultBranch = repoInfo.data.default_branch;
    const defaultRef = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });
    baseSha = defaultRef.data.object.sha;
  }

  // Create the agent branch
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  return branchName;
}

// ---------------------------------------------------------------------------
// POST /api/agent/message
// ---------------------------------------------------------------------------

router.post('/message', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const { message, session_id } = req.body as {
    message?: string;
    session_id?: string;
  };

  if (!message || typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: 'Bad Request', message: 'message is required.' });
    return;
  }

  const db = getDb();
  const settings = getWorkspaceSettings(user.id);

  if (!settings) {
    res.status(400).json({
      error: 'No workspace configured',
      message: 'Please set up your workspace (repo owner, repo name) before using the agent.',
    });
    return;
  }

  // Resolve session ID — use provided or generate a stable one per user
  const sessionId = session_id ?? `default-${user.id}`;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if present
  res.flushHeaders();

  // Keep-alive: send a comment every 15 s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15_000);

  const cleanup = (): void => {
    clearInterval(keepAlive);
  };

  req.on('close', cleanup);

  try {
    // Get Octokit instance for this user
    const octokit = await getOctokitForUser(user);

    const owner = settings.repo_owner!;
    const repo = settings.repo_name!;

    // Ensure agent branch exists
    await ensureAgentBranch(octokit, owner, repo, user.username);

    // Build broadcast function — notifies the collaborator via WebSocket
    const broadcastFn = (sourceUserId: number, event: BroadcastEvent): void => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        broadcastToCollaborator(db, sourceUserId, {
          type: event.type as any,
          payload: event.payload as any,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Non-fatal — WebSocket broadcast failure should not abort the agent
      }
    };

    // Stream callback — converts internal events to SSE frames
    const streamCallback = (streamEvent: {
      type: string;
      content?: string;
      name?: string;
      input?: Record<string, unknown>;
      result?: string;
      error?: string;
    }): void => {
      if (res.writableEnded) return;

      switch (streamEvent.type) {
        case 'token':
          sseWrite(res, { type: 'token', content: streamEvent.content ?? '' });
          break;

        case 'tool_call':
          sseWrite(res, {
            type: 'tool_call',
            name: streamEvent.name ?? '',
            input: streamEvent.input ?? {},
          });
          break;

        case 'tool_result':
          sseWrite(res, {
            type: 'tool_result',
            name: streamEvent.name ?? '',
            result: streamEvent.result ?? '',
          });
          break;

        case 'done':
          sseWrite(res, { type: 'done' });
          break;

        case 'error':
          sseWrite(res, { type: 'error', error: streamEvent.error ?? 'Unknown error' });
          break;
      }
    };

    // AI disabled — return a placeholder response
    if (!process.env.ANTHROPIC_API_KEY) {
      const words = `AI agent is not configured yet. Add your ANTHROPIC_API_KEY environment variable to enable the Claude-powered coding agent. Your message was: "${message.trim()}"`.split(' ');
      for (const word of words) {
        streamCallback({ type: 'token', content: word + ' ' });
        await new Promise(r => setTimeout(r, 30));
      }
      streamCallback({ type: 'done' });
      return;
    }

    // Run the agent
    await runAgentTurn(
      user.id,
      sessionId,
      message.trim(),
      db,
      octokit,
      owner,
      repo,
      {
        agent_name: settings.agent_name,
        agent_role: settings.agent_role,
        repo_owner: settings.repo_owner!,
        repo_name: settings.repo_name!,
      },
      {
        username: user.username,
        display_name: user.display_name ?? user.username,
      },
      broadcastFn,
      streamCallback,
    );
  } catch (err) {
    if (!res.writableEnded) {
      sseWrite(res, {
        type: 'error',
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    }
    console.error('[agent/message] Error:', err);
  } finally {
    cleanup();
    if (!res.writableEnded) {
      res.end();
    }
  }
});

export default router;
