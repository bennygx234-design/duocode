import type { Tool } from '@anthropic-ai/sdk/resources/messages';

/**
 * Anthropic tool definitions for all DuoCode agent tools.
 * Passed directly to the Claude API as the `tools` parameter.
 */
export const toolDefinitions: Tool[] = [
  // -------------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------------
  {
    name: 'read_file',
    description:
      'Read the contents of a file from a GitHub repository branch. Returns the decoded file content as a string.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub repository owner (user or org name).',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name.',
        },
        branch: {
          type: 'string',
          description: 'Branch name to read from (e.g. "main" or "agent-alice").',
        },
        path: {
          type: 'string',
          description: 'File path within the repository (e.g. "src/index.ts").',
        },
      },
      required: ['owner', 'repo', 'branch', 'path'],
    },
  },

  {
    name: 'write_file',
    description:
      'Create or update a file in a GitHub repository branch with a commit. Automatically fetches existing SHA when updating.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        branch: { type: 'string', description: 'Branch to write to.' },
        path: { type: 'string', description: 'File path within the repository.' },
        content: { type: 'string', description: 'Full file content to write (UTF-8 string).' },
        commit_message: {
          type: 'string',
          description: 'Git commit message describing the change.',
        },
      },
      required: ['owner', 'repo', 'branch', 'path', 'content', 'commit_message'],
    },
  },

  {
    name: 'list_files',
    description:
      'List the contents of a directory in a GitHub repository. Returns file names, paths, types (file/dir), and SHAs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        path: {
          type: 'string',
          description: 'Directory path to list. Use "" or "/" for root.',
          default: '',
        },
        branch: {
          type: 'string',
          description: 'Branch to list from.',
          default: 'main',
        },
      },
      required: ['owner', 'repo'],
    },
  },

  {
    name: 'delete_file',
    description: 'Delete a file from a GitHub repository branch with a commit.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        branch: { type: 'string', description: 'Branch to delete from.' },
        path: { type: 'string', description: 'File path to delete.' },
        commit_message: { type: 'string', description: 'Git commit message.' },
      },
      required: ['owner', 'repo', 'branch', 'path', 'commit_message'],
    },
  },

  {
    name: 'rename_file',
    description:
      'Rename (move) a file within a GitHub repository branch. Reads the old file, writes it to the new path, and deletes the old path — all as separate commits.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        branch: { type: 'string', description: 'Branch to operate on.' },
        old_path: { type: 'string', description: 'Current file path.' },
        new_path: { type: 'string', description: 'Desired new file path.' },
        commit_message: { type: 'string', description: 'Git commit message for the rename.' },
      },
      required: ['owner', 'repo', 'branch', 'old_path', 'new_path', 'commit_message'],
    },
  },

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------
  {
    name: 'search_code',
    description:
      'Search for code across a GitHub repository using the GitHub code search API. Returns matching files with path and text fragments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        query: {
          type: 'string',
          description:
            'Search query string (GitHub code search syntax). E.g. "useState extension:tsx".',
        },
      },
      required: ['owner', 'repo', 'query'],
    },
  },

  // -------------------------------------------------------------------------
  // Branches & Merging
  // -------------------------------------------------------------------------
  {
    name: 'check_conflicts',
    description:
      'Check whether a branch has conflicting files relative to a base branch (default: main). Returns a list of conflicting files and whether it is safe to merge.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        branch: { type: 'string', description: 'The feature/agent branch to check.' },
        base: {
          type: 'string',
          description: 'The base branch to compare against.',
          default: 'main',
        },
      },
      required: ['owner', 'repo', 'branch'],
    },
  },

  {
    name: 'merge_to_main',
    description:
      'Merge an agent branch into main. Will REFUSE and throw an error if conflicts are detected. Never force-merges.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        branch: { type: 'string', description: 'Branch to merge into main.' },
        commit_message: { type: 'string', description: 'Merge commit message.' },
      },
      required: ['owner', 'repo', 'branch', 'commit_message'],
    },
  },

  {
    name: 'get_diff',
    description:
      'Get the diff between two branches or commits. Returns changed files, line counts, and patch content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        base: { type: 'string', description: 'Base branch or commit SHA.' },
        head: { type: 'string', description: 'Head branch or commit SHA.' },
      },
      required: ['owner', 'repo', 'base', 'head'],
    },
  },

  {
    name: 'get_commit_log',
    description:
      'Get the commit history for a branch, most recent first. Returns SHA, message, author, and date.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        branch: { type: 'string', description: 'Branch name.' },
        n: {
          type: 'number',
          description: 'Number of commits to return (max 100).',
          default: 10,
        },
      },
      required: ['owner', 'repo', 'branch'],
    },
  },

  // -------------------------------------------------------------------------
  // Pull Requests
  // -------------------------------------------------------------------------
  {
    name: 'create_pr',
    description: 'Open a pull request from a branch into a base branch.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        branch: { type: 'string', description: 'Head branch (source of changes).' },
        title: { type: 'string', description: 'PR title.' },
        body: { type: 'string', description: 'PR description body (Markdown supported).' },
        base_branch: {
          type: 'string',
          description: 'Base branch to merge into.',
          default: 'main',
        },
      },
      required: ['owner', 'repo', 'branch', 'title', 'body'],
    },
  },

  {
    name: 'get_pr_list',
    description: 'List all open pull requests in the repository.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
      },
      required: ['owner', 'repo'],
    },
  },

  {
    name: 'comment_on_pr',
    description: 'Add a review comment to an open pull request.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        pr_number: { type: 'number', description: 'Pull request number.' },
        comment: { type: 'string', description: 'Comment body (Markdown supported).' },
      },
      required: ['owner', 'repo', 'pr_number', 'comment'],
    },
  },

  // -------------------------------------------------------------------------
  // Issues
  // -------------------------------------------------------------------------
  {
    name: 'create_issue',
    description: 'Create a new GitHub issue in the repository.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
        title: { type: 'string', description: 'Issue title.' },
        body: { type: 'string', description: 'Issue description body (Markdown supported).' },
      },
      required: ['owner', 'repo', 'title', 'body'],
    },
  },

  {
    name: 'get_issues',
    description: 'List all open issues in the repository (excludes pull requests).',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
      },
      required: ['owner', 'repo'],
    },
  },

  // -------------------------------------------------------------------------
  // Collaborator
  // -------------------------------------------------------------------------
  {
    name: 'get_collaborator_activity',
    description:
      "Get a summary of your collaborator's recent GitHub activity: last 5 commits, open PRs, and files modified in the last 24 hours. Useful for staying aware of what your pair is working on.",
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner.' },
        repo: { type: 'string', description: 'GitHub repository name.' },
      },
      required: ['owner', 'repo'],
    },
  },
];

export default toolDefinitions;
