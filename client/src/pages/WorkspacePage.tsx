import React, { useState } from 'react';
import type { SessionUser, WorkspaceSettings } from '../api';
import TopBar from '../components/TopBar';
import ChatPanel from '../components/ChatPanel';
import FileExplorer from '../components/FileExplorer';
import CollaboratorFeed from '../components/CollaboratorFeed';
import SettingsModal from '../components/SettingsModal';
import './WorkspacePage.css';

interface Props {
  user: SessionUser;
  settings: WorkspaceSettings;
}

const WorkspacePage: React.FC<Props> = ({ user, settings: initialSettings }) => {
  const [settings, setSettings] = useState<WorkspaceSettings>(initialSettings);
  const [showSettings, setShowSettings] = useState(false);

  // Track files modified by agent in this session (populated via ChatPanel/tool events externally)
  // We store them here so FileExplorer can highlight them.
  const [agentModifiedFiles] = useState<Set<string>>(new Set());

  // Collaborator's recently touched files come from CollaboratorFeed, but FileExplorer
  // just receives them as a prop. For now we pass an empty set; a shared context or
  // lift-state mechanism could populate it from CollaboratorFeed events.
  const [collaboratorFiles] = useState<Set<string>>(new Set());

  const sessionId = `ws-${user.id}`;

  return (
    <div className="workspace-root">
      <TopBar
        user={user}
        settings={settings}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="workspace-body">
        {/* Left sidebar — file explorer */}
        <aside className="workspace-sidebar workspace-sidebar--left">
          <FileExplorer
            agentModifiedFiles={agentModifiedFiles}
            collaboratorRecentFiles={collaboratorFiles}
          />
        </aside>

        {/* Main area — chat */}
        <main className="workspace-main">
          <ChatPanel
            sessionId={sessionId}
            agentName={settings.agent_name || 'Agent'}
          />
        </main>

        {/* Right sidebar — collaborator feed */}
        <aside className="workspace-sidebar workspace-sidebar--right">
          <CollaboratorFeed />
        </aside>
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(updated) => setSettings(updated)}
        />
      )}
    </div>
  );
};

export default WorkspacePage;
