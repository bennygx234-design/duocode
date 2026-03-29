import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSettings, saveSettings } from '../db';
import type { WorkspaceSettingsInput } from 'duocode-shared';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/workspace/settings
// ---------------------------------------------------------------------------

router.get('/settings', (req: Request, res: Response): void => {
  const userId = req.user!.id;
  const settings = getSettings(userId);

  if (!settings) {
    // Return defaults — settings row is lazily created on first PUT
    res.json({
      user_id: userId,
      agent_name: 'Duo',
      role_description: 'AI coding collaborator',
      accent_color: '#6366f1',
      default_branch_behavior: 'feature',
      repo_owner: null,
      repo_name: null,
      updated_at: null,
    });
    return;
  }

  res.json(settings);
});

// ---------------------------------------------------------------------------
// PUT /api/workspace/settings
// Body: Partial<WorkspaceSettingsInput>
// ---------------------------------------------------------------------------

router.put('/settings', (req: Request, res: Response): void => {
  const userId = req.user!.id;

  const body = req.body as Partial<
    WorkspaceSettingsInput & {
      role_description: string;
      default_branch_behavior: string;
    }
  >;

  // Validate accent_color if provided
  if (body.accent_color !== undefined) {
    if (!/^#[0-9a-fA-F]{3,6}$/.test(body.accent_color)) {
      res.status(400).json({
        error: 'Invalid accent_color',
        message: 'accent_color must be a valid hex colour (e.g. #6366f1)',
      });
      return;
    }
  }

  // Map shared type field "agent_role" -> DB field "role_description"
  const updated = saveSettings({
    user_id: userId,
    agent_name: body.agent_name,
    role_description: body.agent_role ?? body.role_description,
    accent_color: body.accent_color,
    default_branch_behavior: body.default_branch_behavior,
    repo_owner: body.repo_owner,
    repo_name: body.repo_name,
  });

  res.json(updated);
});

export default router;
