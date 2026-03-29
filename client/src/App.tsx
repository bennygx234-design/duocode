import React, { useEffect, useState } from 'react';
import { getMe, getWorkspaceSettings } from './api';
import type { SessionUser, WorkspaceSettings } from './api';
import Login from './pages/Login';
import WorkspaceSetup from './pages/WorkspaceSetup';
import WorkspacePage from './pages/WorkspacePage';

type AuthState = 'loading' | 'unauthenticated' | 'no-workspace' | 'ready';

const App: React.FC = () => {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        const me = await getMe();
        setUser(me);

        try {
          const ws = await getWorkspaceSettings();
          // Apply stored accent color immediately
          if (ws.accent_color) {
            document.documentElement.style.setProperty('--accent', ws.accent_color);
          }
          setSettings(ws);
          setAuthState('ready');
        } catch {
          // 404 or no workspace yet
          setAuthState('no-workspace');
        }
      } catch {
        // 401 or network error — not logged in
        setAuthState('unauthenticated');
      }
    }

    bootstrap();
  }, []);

  if (authState === 'loading') {
    return <AppLoader />;
  }

  if (authState === 'unauthenticated') {
    return <Login />;
  }

  if (authState === 'no-workspace') {
    return (
      <WorkspaceSetup
        onComplete={() => {
          // Re-fetch settings after setup completes
          getWorkspaceSettings()
            .then((ws) => {
              setSettings(ws);
              setAuthState('ready');
            })
            .catch(() => {
              // Fallback: reload the page
              window.location.reload();
            });
        }}
      />
    );
  }

  // authState === 'ready'
  if (!user || !settings) return <AppLoader />;

  return <WorkspacePage user={user} settings={settings} />;
};

function AppLoader() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0f0f14',
        color: '#5a5a72',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect width="48" height="48" rx="12" fill="var(--accent, #7c3aed)" />
        <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="700" fontFamily="system-ui">DC</text>
      </svg>
      <div
        style={{
          width: 32,
          height: 32,
          border: '3px solid rgba(255,255,255,0.08)',
          borderTopColor: 'var(--accent, #7c3aed)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default App;
