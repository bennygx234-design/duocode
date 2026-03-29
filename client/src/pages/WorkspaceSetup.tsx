import React, { useState } from 'react';
import { createWorkspaceSettings } from '../api';
import './WorkspaceSetup.css';

const ACCENT_PRESETS = [
  '#7c3aed', // violet
  '#2563eb', // blue
  '#0891b2', // cyan
  '#059669', // emerald
  '#d97706', // amber
  '#dc2626', // red
  '#db2777', // pink
  '#7c3aed', // purple
];

interface Props {
  onComplete: () => void;
}

const WorkspaceSetup: React.FC<Props> = ({ onComplete }) => {
  const [form, setForm] = useState({
    agent_name: '',
    agent_role: '',
    repo_owner: '',
    repo_name: '',
    accent_color: '#7c3aed',
    default_branch: 'main',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.repo_owner.trim() || !form.repo_name.trim()) {
      setError('Repository owner and name are required.');
      return;
    }

    setSaving(true);
    try {
      await createWorkspaceSettings({
        repo_owner: form.repo_owner.trim(),
        repo_name: form.repo_name.trim(),
        agent_name: form.agent_name.trim() || undefined,
        agent_role: form.agent_role.trim() || undefined,
        accent_color: form.accent_color,
      });
      // Apply accent immediately
      document.documentElement.style.setProperty('--accent', form.accent_color);
      onComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="setup-root">
      <div className="setup-card">
        <div className="setup-header">
          <div className="setup-logo">
            <svg width="36" height="36" viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <rect width="48" height="48" rx="12" fill={form.accent_color} />
              <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="700" fontFamily="system-ui">DC</text>
            </svg>
          </div>
          <div>
            <h1 className="setup-title">Configure your workspace</h1>
            <p className="setup-subtitle">Set up your agent and repository to get started.</p>
          </div>
        </div>

        <form className="setup-form" onSubmit={handleSubmit} noValidate>
          {/* Repo section */}
          <fieldset className="setup-fieldset">
            <legend className="setup-legend">Repository</legend>

            <div className="setup-row">
              <label className="setup-label" htmlFor="repo_owner">
                Owner <span className="setup-required">*</span>
              </label>
              <input
                id="repo_owner"
                className="setup-input"
                type="text"
                value={form.repo_owner}
                onChange={(e) => set('repo_owner', e.target.value)}
                placeholder="github-username or org"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="setup-row">
              <label className="setup-label" htmlFor="repo_name">
                Repository name <span className="setup-required">*</span>
              </label>
              <input
                id="repo_name"
                className="setup-input"
                type="text"
                value={form.repo_name}
                onChange={(e) => set('repo_name', e.target.value)}
                placeholder="my-project"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="setup-row">
              <label className="setup-label" htmlFor="default_branch">
                Default branch
              </label>
              <div className="setup-select-wrap">
                <select
                  id="default_branch"
                  className="setup-select"
                  value={form.default_branch}
                  onChange={(e) => set('default_branch', e.target.value)}
                >
                  <option value="main">main</option>
                  <option value="master">master</option>
                  <option value="develop">develop</option>
                </select>
              </div>
            </div>
          </fieldset>

          {/* Agent section */}
          <fieldset className="setup-fieldset">
            <legend className="setup-legend">Your AI Agent</legend>

            <div className="setup-row">
              <label className="setup-label" htmlFor="agent_name">
                Agent name
              </label>
              <input
                id="agent_name"
                className="setup-input"
                type="text"
                value={form.agent_name}
                onChange={(e) => set('agent_name', e.target.value)}
                placeholder="e.g. Aria, Nexus, Dev-1"
                autoComplete="off"
              />
            </div>

            <div className="setup-row">
              <label className="setup-label" htmlFor="agent_role">
                Role description
              </label>
              <textarea
                id="agent_role"
                className="setup-textarea"
                value={form.agent_role}
                onChange={(e) => set('agent_role', e.target.value)}
                placeholder="e.g. Senior frontend engineer focused on React and TypeScript..."
                rows={3}
              />
            </div>
          </fieldset>

          {/* Appearance section */}
          <fieldset className="setup-fieldset">
            <legend className="setup-legend">Appearance</legend>

            <div className="setup-row">
              <label className="setup-label">Accent color</label>
              <div className="setup-color-grid">
                {ACCENT_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`setup-color-swatch${form.accent_color === color ? ' selected' : ''}`}
                    style={{ background: color }}
                    onClick={() => set('accent_color', color)}
                    aria-label={`Accent color ${color}`}
                  />
                ))}
                <label className="setup-color-custom" title="Custom color">
                  <input
                    type="color"
                    value={form.accent_color}
                    onChange={(e) => set('accent_color', e.target.value)}
                    style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}
                  />
                  <span style={{ background: form.accent_color }} className="setup-color-swatch custom-swatch" />
                </label>
              </div>
            </div>
          </fieldset>

          {error && <p className="setup-error">{error}</p>}

          <button type="submit" className="setup-submit" disabled={saving}>
            {saving ? 'Saving…' : 'Launch workspace'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default WorkspaceSetup;
