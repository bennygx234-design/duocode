import React from 'react';
import './Login.css';

const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID as string;

function buildGitHubOAuthURL(): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID ?? '',
    scope: 'repo,read:user,user:email',
    redirect_uri: `http://localhost:3001/api/auth/github/callback`,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

const Login: React.FC = () => {
  const handleLogin = () => {
    window.location.href = buildGitHubOAuthURL();
  };

  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect width="48" height="48" rx="12" fill="var(--accent, #7c3aed)" />
            <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="700" fontFamily="system-ui">DC</text>
          </svg>
        </div>

        <h1 className="login-title">DuoCode</h1>
        <p className="login-subtitle">A collaborative AI workspace for two</p>

        <div className="login-divider" />

        <p className="login-description">
          Two developers. Two AI agents. One shared repo. Build together — each agent works on its
          own branch, proposes changes, and merges cleanly into main.
        </p>

        <button className="login-github-btn" onClick={handleLogin} type="button">
          <GitHubIcon />
          Sign in with GitHub
        </button>

        <p className="login-legal">
          By signing in you agree to allow DuoCode to access your GitHub repositories.
        </p>
      </div>
    </div>
  );
};

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.373 0 12c0 5.302 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.298 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

export default Login;
