import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getRepoTree, getFileContent } from '../api';
import type { RepoFile } from 'duocode-shared';
import './FileExplorer.css';

interface TreeNode extends RepoFile {
  children?: TreeNode[];
  expanded?: boolean;
}

interface Props {
  agentModifiedFiles: Set<string>;
  collaboratorRecentFiles: Set<string>;
}

// Group flat list into tree
function buildTree(files: RepoFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  const sorted = [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const file of sorted) {
    const node: TreeNode = { ...file, children: file.type === 'dir' ? [] : undefined, expanded: false };
    byPath.set(file.path, node);
    const parentPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : null;
    if (parentPath && byPath.has(parentPath)) {
      byPath.get(parentPath)!.children!.push(node);
    } else {
      root.push(node);
    }
  }
  return root;
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    css: 'css', scss: 'scss', html: 'html', json: 'json', md: 'markdown',
    yml: 'yaml', yaml: 'yaml', sh: 'bash', toml: 'toml', sql: 'sql',
  };
  return map[ext] ?? 'plaintext';
}

// ── Tree node row ─────────────────────────────────────────────────────────────

interface NodeRowProps {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onSelect: (node: TreeNode) => void;
  agentModified: Set<string>;
  collaboratorRecent: Set<string>;
  selectedPath: string | null;
}

const NodeRow: React.FC<NodeRowProps> = ({
  node, depth, onToggle, onSelect, agentModified, collaboratorRecent, selectedPath,
}) => {
  const isSelected = selectedPath === node.path;
  const isAgentMod = agentModified.has(node.path);
  const isCollab = collaboratorRecent.has(node.path);

  return (
    <>
      <div
        className={`fe-row${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
        onClick={() => node.type === 'dir' ? onToggle(node.path) : onSelect(node)}
        role={node.type === 'dir' ? 'button' : 'button'}
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && (node.type === 'dir' ? onToggle(node.path) : onSelect(node))}
      >
        <span className="fe-row-icon">
          {node.type === 'dir' ? (
            node.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />
          ) : (
            <FileIcon filename={node.name} />
          )}
        </span>
        <span className="fe-row-name">{node.name}</span>
        {isAgentMod && <span className="fe-badge fe-badge--agent" title="Modified by your agent">M</span>}
        {isCollab && <span className="fe-badge fe-badge--collab" title="Recently touched by collaborator">C</span>}
      </div>

      {node.type === 'dir' && node.expanded && node.children?.map((child) => (
        <NodeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          onToggle={onToggle}
          onSelect={onSelect}
          agentModified={agentModified}
          collaboratorRecent={collaboratorRecent}
          selectedPath={selectedPath}
        />
      ))}
    </>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

const FileExplorer: React.FC<Props> = ({ agentModifiedFiles, collaboratorRecentFiles }) => {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const expandedRef = useRef(new Set<string>());

  useEffect(() => {
    setLoading(true);
    getRepoTree()
      .then((files) => {
        setTree(buildTree(files));
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleDir = useCallback((path: string) => {
    setTree((prev) => {
      function toggle(nodes: TreeNode[]): TreeNode[] {
        return nodes.map((n) => {
          if (n.path === path) {
            const expanded = !n.expanded;
            if (expanded) expandedRef.current.add(path);
            else expandedRef.current.delete(path);
            return { ...n, expanded };
          }
          if (n.children) return { ...n, children: toggle(n.children) };
          return n;
        });
      }
      return toggle(prev);
    });
  }, []);

  const selectFile = useCallback((node: TreeNode) => {
    setSelectedPath(node.path);
    setFileLoading(true);
    setFileContent(null);
    getFileContent(node.path)
      .then((fc) => {
        // content may be base64 encoded
        try {
          const decoded = atob(fc.content.replace(/\n/g, ''));
          setFileContent(decoded);
        } catch {
          setFileContent(fc.content);
        }
      })
      .catch((e) => setFileContent(`Error loading file: ${e.message}`))
      .finally(() => setFileLoading(false));
  }, []);

  const closeViewer = () => {
    setSelectedPath(null);
    setFileContent(null);
  };

  return (
    <div className="fe-root">
      <div className="fe-header">
        <span className="fe-header-label">Explorer</span>
        {loading && <span className="fe-loading-dot" />}
      </div>

      {error && <div className="fe-error">{error}</div>}

      {!loading && !error && (
        <div className="fe-tree">
          {tree.map((node) => (
            <NodeRow
              key={node.path}
              node={node}
              depth={0}
              onToggle={toggleDir}
              onSelect={selectFile}
              agentModified={agentModifiedFiles}
              collaboratorRecent={collaboratorRecentFiles}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}

      {/* File viewer */}
      {selectedPath && (
        <div className="fe-viewer">
          <div className="fe-viewer-header">
            <span className="fe-viewer-path">{selectedPath}</span>
            <button className="fe-viewer-close" onClick={closeViewer} type="button" aria-label="Close file viewer">
              <CloseIcon />
            </button>
          </div>
          <div className="fe-viewer-body">
            {fileLoading ? (
              <div className="fe-viewer-loading">Loading…</div>
            ) : (
              <pre className="fe-viewer-code" data-lang={getLanguage(selectedPath.split('/').pop() ?? '')}>
                <code>{fileContent}</code>
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M12.78 6.22a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06 0L3.22 7.28a.75.75 0 011.06-1.06L8 9.94l3.72-3.72a.75.75 0 011.06 0z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
    </svg>
  );
}

const FILE_ICONS: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#61dafb',
  css: '#264de4', scss: '#cc6699', html: '#e34f26', json: '#fbc02d',
  md: '#ffffff', py: '#3572A5', go: '#00add8', rs: '#ce422b',
  yml: '#cb171e', yaml: '#cb171e', sh: '#4eaa25', toml: '#9c4121',
  sql: '#e38d00', rb: '#cc342d', java: '#007396',
};

function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const color = FILE_ICONS[ext] ?? '#8b8b9e';
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill={color} aria-hidden="true">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0112.25 16h-8.5A1.75 1.75 0 012 14.25V1.75zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V6h-2.75A1.75 1.75 0 018 4.25V1.5H3.75zm5 .56v2.19c0 .138.112.25.25.25h2.19L8.75 2.06z" />
    </svg>
  );
}

export default FileExplorer;
