import { Router } from 'express';
import type { Request, Response } from 'express';
import { createOctokitFromToken } from '../github';
import { upsertUser, getUser } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/auth/github/callback  — GitHub OAuth redirect callback
// GET /api/auth/github?code=...  — alternate form
// POST /api/auth/github          — Body: { code: string }
// ---------------------------------------------------------------------------

async function handleOAuthCode(code: string, req: Request, res: Response): Promise<void> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(500).send('GitHub OAuth is not configured on the server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env');
    return;
  }

  let accessToken: string;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
    if (tokenData.error || !tokenData.access_token) {
      res.status(400).json({ error: tokenData.error ?? 'token_exchange_failed', message: tokenData.error_description });
      return;
    }
    accessToken = tokenData.access_token;
  } catch (err) {
    console.error('[Auth] Token exchange error:', err);
    res.status(502).json({ error: 'Failed to reach GitHub token endpoint' });
    return;
  }

  let githubUser: { id: number; login: string; name?: string | null; avatar_url: string };
  try {
    const octokit = createOctokitFromToken(accessToken);
    const { data } = await octokit.rest.users.getAuthenticated();
    githubUser = { id: data.id, login: data.login, name: data.name, avatar_url: data.avatar_url };
  } catch (err) {
    console.error('[Auth] GitHub profile fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch GitHub user profile' });
    return;
  }

  const user = upsertUser({ github_id: githubUser.id, login: githubUser.login, name: githubUser.name, avatar_url: githubUser.avatar_url, access_token: accessToken });
  req.session.userId = user.id;

  res.json({ user: { id: user.id, github_id: user.github_id, login: user.login, name: user.name, avatar_url: user.avatar_url } });
}

// GET callback — GitHub redirects here after OAuth authorization
router.get('/github/callback', async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send('Missing OAuth code in callback');
    return;
  }
  // Exchange code, create session, then redirect to the SPA
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).send('GitHub OAuth not configured');
    return;
  }
  let accessToken: string;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
    if (tokenData.error || !tokenData.access_token) {
      res.status(400).send(`OAuth error: ${tokenData.error_description ?? tokenData.error}`);
      return;
    }
    accessToken = tokenData.access_token;
  } catch (err) {
    console.error('[Auth] Token exchange error:', err);
    res.status(502).send('Failed to reach GitHub token endpoint');
    return;
  }
  try {
    const octokit = createOctokitFromToken(accessToken);
    const { data } = await octokit.rest.users.getAuthenticated();
    const user = upsertUser({ github_id: data.id, login: data.login, name: data.name, avatar_url: data.avatar_url, access_token: accessToken });
    req.session.userId = user.id;
    // Redirect back to the SPA
    res.redirect('http://localhost:5173');
  } catch (err) {
    console.error('[Auth] GitHub profile fetch error:', err);
    res.status(502).send('Failed to fetch GitHub user profile');
  }
});

router.post('/github', async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body as { code?: string };

  if (!code) {
    res.status(400).json({ error: 'Missing OAuth code' });
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'GitHub OAuth is not configured on the server' });
    return;
  }

  // Exchange code for access token
  let accessToken: string;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      res.status(400).json({
        error: tokenData.error ?? 'token_exchange_failed',
        message: tokenData.error_description ?? 'Failed to exchange OAuth code for token',
      });
      return;
    }

    accessToken = tokenData.access_token;
  } catch (err) {
    console.error('[Auth] Token exchange error:', err);
    res.status(502).json({ error: 'Failed to reach GitHub token endpoint' });
    return;
  }

  // Fetch the authenticated user's profile
  let githubUser: { id: number; login: string; name?: string | null; avatar_url: string };
  try {
    const octokit = createOctokitFromToken(accessToken);
    const { data } = await octokit.rest.users.getAuthenticated();
    githubUser = {
      id: data.id,
      login: data.login,
      name: data.name,
      avatar_url: data.avatar_url,
    };
  } catch (err) {
    console.error('[Auth] GitHub profile fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch GitHub user profile' });
    return;
  }

  // Upsert into DB and create session
  const user = upsertUser({
    github_id: githubUser.id,
    login: githubUser.login,
    name: githubUser.name,
    avatar_url: githubUser.avatar_url,
    access_token: accessToken,
  });

  req.session.userId = user.id;

  res.json({
    user: {
      id: user.id,
      github_id: user.github_id,
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me  — return current session user (no sensitive data)
// ---------------------------------------------------------------------------

router.get('/me', (req: Request, res: Response): void => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const user = getUser(userId);
  if (!user) {
    req.session.destroy(() => {
      res.status(401).json({ error: 'Session user not found' });
    });
    return;
  }

  res.json({
    user: {
      id: user.id,
      github_id: user.github_id,
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

router.post('/logout', requireAuth, (req: Request, res: Response): void => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Session destruction error:', err);
      res.status(500).json({ error: 'Failed to destroy session' });
      return;
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

export default router;
