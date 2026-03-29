import React, { useEffect, useState } from 'react';
import { getCollaboratorActivity } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import type { CollaboratorActivity, WSEvent } from 'duocode-shared';
import './CollaboratorFeed.css';

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const WS_URL = (() => {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    return apiUrl.replace(/^http/, 'ws') + '/ws';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
})();

const CollaboratorFeed: React.FC = () => {
  const [activity, setActivity] = useState<CollaboratorActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastActiveAt, setLastActiveAt] = useState<Date | null>(null);

  const { lastMessage, connected } = useWebSocket(WS_URL);

  // Initial fetch
  useEffect(() => {
    getCollaboratorActivity()
      .then((data) => {
        setActivity(data);
        if (data.last_active_at) setLastActiveAt(new Date(data.last_active_at));
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // WebSocket live updates
  useEffect(() => {
    if (!lastMessage) return;
    try {
      const event = JSON.parse(lastMessage.data as string) as WSEvent;
      setLastActiveAt(new Date(event.timestamp));

      if (event.type === 'collaborator_push') {
        const payload = event.payload as { user: string; branch: string; commits: CollaboratorActivity['recent_commits'] };
        setActivity((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            recent_commits: [...payload.commits, ...prev.recent_commits].slice(0, 10),
            is_active: true,
            last_active_at: event.timestamp,
          };
        });
      } else if (event.type === 'collaborator_status') {
        const payload = event.payload as { user: string; is_active: boolean };
        setActivity((prev) => {
          if (!prev) return prev;
          return { ...prev, is_active: payload.is_active, last_active_at: event.timestamp };
        });
      } else if (event.type === 'collaborator_action') {
        setActivity((prev) => {
          if (!prev) return prev;
          return { ...prev, is_active: true, last_active_at: event.timestamp };
        });
      }
    } catch {
      // non-JSON message; ignore
    }
  }, [lastMessage]);

  // Recompute is_active based on last_active_at (60s window)
  const isActive = activity?.is_active &&
    lastActiveAt != null &&
    Date.now() - lastActiveAt.getTime() < 60_000;

  return (
    <div className="cf-root">
      <div className="cf-header">
        <span className="cf-header-label">Collaborator</span>
        <div className="cf-ws-indicator" title={connected ? 'Live' : 'Reconnecting…'}>
          <span className={`cf-ws-dot${connected ? ' connected' : ''}`} />
          <span className="cf-ws-text">{connected ? 'Live' : 'Offline'}</span>
        </div>
      </div>

      {loading && <div className="cf-loading">Loading…</div>}
      {error && <div className="cf-error">{error}</div>}

      {activity && (
        <>
          {/* Collaborator identity */}
          <div className="cf-identity">
            <div className="cf-avatar-wrap">
              <div className="cf-avatar-placeholder">
                {(activity.display_name || activity.username || '?')[0].toUpperCase()}
              </div>
              {isActive && <span className="cf-active-ring" />}
            </div>
            <div className="cf-identity-info">
              <span className="cf-display-name">{activity.display_name || activity.username}</span>
              <span className="cf-role">{activity.role || 'Collaborator'}</span>
            </div>
            {isActive && (
              <div className="cf-active-badge">
                <span className="cf-pulse-dot" />
                Active
              </div>
            )}
          </div>

          {/* Branch */}
          <div className="cf-branch-row">
            <BranchIcon />
            <span className="cf-branch">{activity.branch || 'unknown'}</span>
          </div>

          {/* Recent commits */}
          {activity.recent_commits.length > 0 && (
            <div className="cf-section">
              <div className="cf-section-title">Recent Commits</div>
              <div className="cf-commits">
                {activity.recent_commits.slice(0, 10).map((commit, i) => (
                  <div key={commit.sha + i} className="cf-commit">
                    <div className="cf-commit-sha">{commit.sha.slice(0, 7)}</div>
                    <div className="cf-commit-body">
                      <div className="cf-commit-msg">{commit.message}</div>
                      {commit.files_changed.length > 0 && (
                        <div className="cf-commit-files">
                          {commit.files_changed.slice(0, 3).map((f) => (
                            <span key={f} className="cf-commit-file">{f.split('/').pop()}</span>
                          ))}
                          {commit.files_changed.length > 3 && (
                            <span className="cf-commit-file-more">+{commit.files_changed.length - 3}</span>
                          )}
                        </div>
                      )}
                      <div className="cf-commit-time">{formatRelativeTime(commit.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recently modified files */}
          {activity.recently_modified_files.length > 0 && (
            <div className="cf-section">
              <div className="cf-section-title">Modified Files</div>
              <div className="cf-files">
                {activity.recently_modified_files.slice(0, 8).map((f) => (
                  <div key={f} className="cf-file-row">
                    <span className="cf-file-dot" />
                    <span className="cf-file-path">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open PRs */}
          {activity.open_prs.length > 0 && (
            <div className="cf-section">
              <div className="cf-section-title">Open PRs</div>
              <div className="cf-prs">
                {activity.open_prs.map((pr) => (
                  <a key={pr.number} className="cf-pr" href={pr.html_url} target="_blank" rel="noreferrer">
                    <span className="cf-pr-number">#{pr.number}</span>
                    <span className="cf-pr-title">{pr.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}

export default CollaboratorFeed;
