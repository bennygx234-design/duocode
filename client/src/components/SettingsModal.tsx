import React, { useEffect, useState } from 'react';
import { updateWorkspaceSettings } from '../api';
import type { WorkspaceSettings } from '../api';
import './SettingsModal.css';

const ACCENT_PRESETS = [
  '#7c3aed', '#2563eb', '#0891b2', '#059669',
  '#d97706', '#dc2626', '#db2777',
];

interface Props {
  settings: WorkspaceSettings;
  onClose: () => void;
  onSave: (updated: WorkspaceSettings) => void;
}

const SettingsModal: React.FC<Props> = ({ settings, onClose, onSave }) => {
  const [form, setForm] = useState({
    agent_name: settings.agent_name ?? '',
    agent_role: settings.agent_role ?? '',
    accent_color: settings.accent_color ?? '#7c3aed',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent scroll on body
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = await updateWorkspaceSettings({
        agent_name: form.agent_name.trim() || undefined,
        agent_role: form.agent_role.trim() || undefined,
        accent_color: form.accent_color,
      });
      document.documentElement.style.setProperty('--accent', form.accent_color);
      setSuccess(true);
      onSave(updated);
      setTimeout(() => onClose(), 800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="sm-modal">
        <div className="sm-header">
          <h2 className="sm-title">Agent Settings</h2>
          <button className="sm-close" onClick={onClose} type="button" aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <form className="sm-form" onSubmit={handleSave} noValidate>
          <div className="sm-row">
            <label className="sm-label" htmlFor="sm-agent-name">Agent name</label>
            <input
              id="sm-agent-name"
              className="sm-input"
              type="text"
              value={form.agent_name}
              onChange={(e) => set('agent_name', e.target.value)}
              placeholder="e.g. Aria, Nexus"
              autoComplete="off"
            />
          </div>

          <div className="sm-row">
            <label className="sm-label" htmlFor="sm-agent-role">Role description</label>
            <textarea
              id="sm-agent-role"
              className="sm-textarea"
              value={form.agent_role}
              onChange={(e) => set('agent_role', e.target.value)}
              placeholder="e.g. Senior frontend engineer focused on React…"
              rows={3}
            />
          </div>

          <div className="sm-row">
            <label className="sm-label">Accent color</label>
            <div className="sm-color-grid">
              {ACCENT_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`sm-swatch${form.accent_color === color ? ' selected' : ''}`}
                  style={{ background: color }}
                  onClick={() => set('accent_color', color)}
                  aria-label={`Accent color ${color}`}
                />
              ))}
              <label className="sm-swatch-custom-label" title="Custom color">
                <input
                  type="color"
                  value={form.accent_color}
                  onChange={(e) => set('accent_color', e.target.value)}
                  style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}
                />
                <span
                  className={`sm-swatch custom${!ACCENT_PRESETS.includes(form.accent_color) ? ' selected' : ''}`}
                  style={{ background: form.accent_color }}
                />
              </label>
            </div>
          </div>

          {error && <p className="sm-error">{error}</p>}
          {success && <p className="sm-success">Saved!</p>}

          <div className="sm-actions">
            <button type="button" className="sm-btn-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="sm-btn-save" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
    </svg>
  );
}

export default SettingsModal;
