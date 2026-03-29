import React, { useEffect, useState } from 'react';
import { getCommitStatus, type CommitStatus, type SessionUser, type WorkspaceSettings } from '../api';
import './TopBar.css';

interface Props {
  user: SessionUser;
  settings: WorkspaceSettings;
  onOpenSettings: () => void;
}

const TopBar: React.FC<Props> = ({ user, settings, onOpenSettings }) => {
  const [status, setStatus] = useState<CommitStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () =>
      getCommitStatus()
        .then((s) => { if (mounted) setStatus(s); })
        .catch(() => {});

    load();
    const interval = setInterval(load, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const repoUrl = `https://github.com/${settings.repo_owner}/${settings.repo_name}`;
  const openPRsUrl = `${repoUrl}/pulls`;

  return (
    <header className="topbar">
      {/* Left: repo + branch */}
      <div className="topbar-left">
        <a className="topbar-repo" href={repoUrl} target="_blank" rel="noreferrer" title="Open on GitHub">
          <RepoIcon />
          <span className="topbar-repo-owner">{settings.repo_owner}</span>
          <span className="topbar-repo-sep">/</span>
          <span className="topbar-repo-name">{settings.repo_name}</span>
          <ExternalLinkIcon />
        </a>

        {status && (
          <div className="topbar-branch">
            <BranchIcon />
            <span>{status.branch}</span>
          </div>
        )}
      </div>

      {/* Center: status pills */}
      <div className="topbar-center">
        {status && (
          <>
            <CommitStatusPill ahead={status.ahead} behind={status.behind} base={status.base} />
            <MergeStatusPill mergeStatus={status.last_merge_status ?? null} />
            {status.open_prs.length > 0 && (
              <a
                className="topbar-pill topbar-pill--prs"
                href={openPRsUrl}
                target="_blank"
                rel="noreferrer"
              >
                <PRIcon />
                {status.open_prs.length} open PR{status.open_prs.length !== 1 ? 's' : ''}
              </a>
            )}
          </>
        )}
      </div>

      {/* Right: user + settings */}
      <div className="topbar-right">
        <div className="topbar-user">
          <img
            className="topbar-avatar"
            src={user.avatar_url}
            alt={user.display_name}
            referrerPolicy="no-referrer"
          />
          <span className="topbar-username">{user.display_name || user.username}</span>
        </div>
        <button className="topbar-settings-btn" onClick={onOpenSettings} title="Settings" type="button">
          <GearIcon />
        </button>
      </div>
    </header>
  );
};

// ── Sub-components ──────────────────────────────────────────────────────────

function CommitStatusPill({ ahead, behind, base }: { ahead: number; behind: number; base: string }) {
  if (ahead === 0 && behind === 0) {
    return (
      <span className="topbar-pill topbar-pill--clean" title={`Up to date with ${base}`}>
        Up to date
      </span>
    );
  }
  return (
    <span className="topbar-pill topbar-pill--commits" title={`vs ${base}`}>
      {ahead > 0 && <span>+{ahead}</span>}
      {behind > 0 && <span>-{behind}</span>}
      vs {base}
    </span>
  );
}

function MergeStatusPill({ mergeStatus }: { mergeStatus: 'clean' | 'conflict' | null }) {
  if (!mergeStatus) return null;
  if (mergeStatus === 'clean') {
    return <span className="topbar-pill topbar-pill--clean">Clean merge</span>;
  }
  return <span className="topbar-pill topbar-pill--conflict">Conflict pending</span>;
}

// ── Icons ────────────────────────────────────────────────────────────────────

function RepoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8A1 1 0 005 13.25a1 1 0 001-1v-.25H4.5A2.5 2.5 0 012 9.5v-7zm4.5 0a1 1 0 00-1 1v7h7V2.5h-6z" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ opacity: 0.5 }}>
      <path d="M3.75 2h3.5a.75.75 0 010 1.5h-3.5a.25.25 0 00-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25v-3.5a.75.75 0 011.5 0v3.5A1.75 1.75 0 0112.25 14h-8.5A1.75 1.75 0 012 12.25v-8.5C2 2.784 2.784 2 3.75 2zm6.854-1h4.146a.25.25 0 01.25.25v4.146a.25.25 0 01-.427.177L13.03 4.03 9.28 7.78a.75.75 0 01-1.06-1.06l3.75-3.75-1.543-1.543A.25.25 0 0110.604 1z" />
    </svg>
  );
}

function PRIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M7.429 1.525a6.593 6.593 0 011.142 0c.036.003.108.036.137.146l.289 1.105c.147.56.55.967.997 1.189.174.086.341.183.501.29.417.278.97.423 1.53.27l1.102-.303c.11-.03.175.016.195.046.219.31.41.641.573.988.063.13.04.205-.015.27l-.763.888a1.8 1.8 0 00-.27 1.541c.055.22.089.447.089.682s-.034.462-.089.682a1.8 1.8 0 00.27 1.54l.763.889c.055.065.078.14.015.27a6.59 6.59 0 01-.573.987c-.02.03-.085.076-.195.046l-1.103-.303c-.559-.153-1.112-.008-1.529.27-.16.107-.327.204-.5.29-.449.222-.851.628-.999 1.189l-.289 1.105c-.029.11-.101.143-.137.146a6.613 6.613 0 01-1.142 0c-.036-.003-.108-.036-.137-.146l-.289-1.105c-.147-.56-.55-.967-.997-1.189a5.078 5.078 0 01-.501-.29c-.417-.278-.97-.423-1.53-.27l-1.102.303c-.11.03-.175-.016-.195-.046a6.586 6.586 0 01-.573-.988c-.063-.13-.04-.205.015-.27l.763-.888a1.8 1.8 0 00.27-1.541 5.192 5.192 0 01-.089-.682c0-.235.034-.462.089-.682a1.8 1.8 0 00-.27-1.54l-.763-.889c-.055-.065-.078-.14-.015-.27.163-.349.353-.679.573-.987.02-.03.085-.076.195-.046l1.103.303c.559.153 1.112.008 1.529-.27.16-.107.327-.204.5-.29.449-.222.851-.628.999-1.189l.289-1.105c.029-.11.101-.143.137-.146zM8 10a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  );
}

export default TopBar;
