import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { getAllUsers, getSettings } from '../db';
import { broadcastToUser } from '../websocket';
import type {
  WSEvent,
  CollaboratorPushEvent,
  CollaboratorMergeEvent,
  CollaboratorActionEvent,
} from 'duocode-shared';

const router = Router();

// ---------------------------------------------------------------------------
// HMAC-SHA256 signature verification
// ---------------------------------------------------------------------------

function verifyGitHubSignature(req: Request): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Webhook] GITHUB_WEBHOOK_SECRET is not set — skipping signature check');
    return true; // In development without a secret configured, allow through
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) return false;

  // req.body must be the raw Buffer; we use express.raw() for this route
  const rawBody: Buffer | undefined = req.body as Buffer | undefined;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    console.error('[Webhook] Raw body not available — mount webhook route before json() middleware');
    return false;
  }

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resolve the recipient user for a push/PR event
// GitHub sender login -> the *other* user in the DB (the one who should
// receive the notification).
// ---------------------------------------------------------------------------

function findRecipientUserId(senderLogin: string): number | null {
  const allUsers = getAllUsers();
  // Find the user who is NOT the sender
  const recipient = allUsers.find(
    (u) => u.login.toLowerCase() !== senderLogin.toLowerCase()
  );
  return recipient?.id ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/github/webhook
//
// NOTE: This route needs the raw body for signature verification.
// Mount it with express.raw({ type: 'application/json' }) BEFORE express.json().
// The index.ts mounts this router with a raw body parser applied at route level.
// ---------------------------------------------------------------------------

router.post(
  '/',
  // Inline raw body parser for this specific route
  (req: Request, res: Response, next) => {
    // If body is already a Buffer (mounted with raw parser) go straight to handler
    if (Buffer.isBuffer(req.body)) {
      next();
      return;
    }
    // Otherwise collect the raw bytes manually
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      req.body = Buffer.concat(chunks);
      next();
    });
    req.on('error', next);
  },
  (req: Request, res: Response): void => {
    if (!verifyGitHubSignature(req)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const event = req.headers['x-github-event'] as string | undefined;

    let payload: Record<string, unknown>;
    try {
      const rawBody = req.body as Buffer;
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    console.log(`[Webhook] Received event: ${event}`);

    // Acknowledge immediately — GitHub expects a fast response
    res.status(200).json({ received: true });

    // Process async (do not await)
    void handleWebhookEvent(event ?? '', payload);
  }
);

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleWebhookEvent(
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const sender = (payload.sender as { login?: string } | undefined)?.login ?? 'unknown';

  switch (event) {
    case 'push':
      await handlePushEvent(sender, payload);
      break;
    case 'pull_request':
      await handlePREvent(sender, payload);
      break;
    default:
      console.log(`[Webhook] Unhandled event type: ${event}`);
  }
}

async function handlePushEvent(
  senderLogin: string,
  payload: Record<string, unknown>
): Promise<void> {
  const recipientId = findRecipientUserId(senderLogin);
  if (recipientId === null) {
    console.log('[Webhook] No recipient found for push event');
    return;
  }

  const ref = (payload.ref as string | undefined) ?? '';
  const branch = ref.replace('refs/heads/', '');

  const rawCommits = (payload.commits as Array<Record<string, unknown>> | undefined) ?? [];
  const commits = rawCommits.map((c) => ({
    sha: (c.id as string) ?? '',
    message: (c.message as string) ?? '',
    author:
      ((c.author as Record<string, unknown> | undefined)?.name as string | undefined) ??
      senderLogin,
    date: (c.timestamp as string) ?? new Date().toISOString(),
    files_changed: [
      ...((c.added as string[] | undefined) ?? []),
      ...((c.modified as string[] | undefined) ?? []),
      ...((c.removed as string[] | undefined) ?? []),
    ],
  }));

  const compareUrl =
    (payload.compare as string | undefined) ??
    `https://github.com/${(payload.repository as Record<string, unknown> | undefined)?.full_name ?? ''}/compare`;

  const pushPayload: CollaboratorPushEvent = {
    user: senderLogin,
    branch,
    commits,
    compare_url: compareUrl,
  };

  const wsEvent: WSEvent = {
    type: 'collaborator_push',
    payload: pushPayload,
    timestamp: new Date().toISOString(),
  };

  const sent = broadcastToUser(recipientId, wsEvent);
  console.log(
    `[Webhook] Push event broadcasted to user ${recipientId}: ${sent ? 'delivered' : 'user offline'}`
  );
}

async function handlePREvent(
  senderLogin: string,
  payload: Record<string, unknown>
): Promise<void> {
  const recipientId = findRecipientUserId(senderLogin);
  if (recipientId === null) {
    console.log('[Webhook] No recipient found for PR event');
    return;
  }

  const action = (payload.action as string | undefined) ?? 'unknown';
  const pr = payload.pull_request as Record<string, unknown> | undefined;

  if (!pr) return;

  const prTitle = (pr.title as string | undefined) ?? '';
  const prBranch = ((pr.head as Record<string, unknown> | undefined)?.ref as string | undefined) ?? '';
  const mergedAt = pr.merged_at as string | null;

  const prHtmlUrl = (pr.html_url as string | undefined) ?? '';
  const prBaseBranch =
    ((pr.base as Record<string, unknown> | undefined)?.ref as string | undefined) ?? 'main';

  if (action === 'closed' && mergedAt) {
    // Merge event
    const files = await resolveFilesChangedInPR(recipientId, pr);
    const mergePayload: CollaboratorMergeEvent = {
      user: senderLogin,
      merged_at: mergedAt,
      commit_message: prTitle,
      files_changed: files,
      base_branch: prBaseBranch,
    };
    const wsEvent: WSEvent = {
      type: 'collaborator_merge',
      payload: mergePayload,
      timestamp: new Date().toISOString(),
    };
    broadcastToUser(recipientId, wsEvent);
  } else {
    // Other PR action (opened, review_requested, etc.)
    const actionPayload: CollaboratorActionEvent = {
      user: senderLogin,
      action: `pr_${action}`,
      resource_type: 'pr',
      resource_title: prTitle,
      resource_url: prHtmlUrl,
      commit_message: prTitle,
    };
    const wsEvent: WSEvent = {
      type: 'collaborator_action',
      payload: actionPayload,
      timestamp: new Date().toISOString(),
    };
    broadcastToUser(recipientId, wsEvent);
  }

  console.log(`[Webhook] PR ${action} event broadcasted to user ${recipientId}`);
}

async function resolveFilesChangedInPR(
  recipientId: number,
  _pr: Record<string, unknown>
): Promise<string[]> {
  // Without an Octokit call here (which would require the recipient's token),
  // we return an empty array. The full implementation in a real scenario would
  // use the GitHub API to list changed files in the PR.
  void recipientId;
  return [];
}

export default router;
