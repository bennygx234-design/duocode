import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { Octokit } from '@octokit/rest';
import type { Database } from '../db';
import { toolDefinitions } from './toolDefinitions';
import {
  read_file,
  write_file,
  list_files,
  search_code,
  check_conflicts,
  merge_to_main,
  create_pr,
  get_pr_list,
  comment_on_pr,
  get_diff,
  get_commit_log,
  get_collaborator_activity,
  create_issue,
  get_issues,
  delete_file,
  rename_file,
} from './tools';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 20; // hard ceiling on agentic loops

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BroadcastFn = (userId: number, event: BroadcastEvent) => void;

export interface BroadcastEvent {
  type: 'collaborator_action' | 'collaborator_push' | 'collaborator_merge';
  payload: Record<string, unknown>;
}

export type StreamCallback = (event: StreamEvent) => void;

export interface StreamEvent {
  type: 'token' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  name?: string;
  input?: Record<string, unknown>;
  result?: string;
  error?: string;
}

// Stored in DB as JSON
interface StoredMessage {
  role: 'user' | 'assistant';
  content: string; // JSON-serialised MessageParam content
}

// ---------------------------------------------------------------------------
// Anthropic client (singleton)
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  user: { username: string; display_name: string },
  settings: { repo_owner: string; repo_name: string; agent_name: string; agent_role: string },
  collaboratorActivity: string,
): string {
  const agentBranch = `agent-${user.username}`;
  const toolList = toolDefinitions.map((t) => `  - ${t.name}: ${t.description}`).join('\n');

  return `You are ${settings.agent_name || 'CodePal'}, an expert AI coding assistant for DuoCode.

## Your Identity
- Agent Name: ${settings.agent_name || 'CodePal'}
- Assigned Role: ${settings.agent_role || 'Full-Stack Developer'}
- Working as: ${user.display_name} (@${user.username})

## Repository
- Owner/Org: ${settings.repo_owner}
- Repository: ${settings.repo_name}
- Default Branch: main
- Your Working Branch: ${agentBranch}

## Core Rules
1. Always work on your assigned branch (${agentBranch}) unless explicitly asked to target another.
2. Never force-merge or bypass conflict checks. Use check_conflicts before merge_to_main.
3. Write clear, descriptive commit messages.
4. Communicate intent before making destructive changes (delete, rename, merge).
5. When you read a file before editing it, show the user what you found before writing.

## Available Tools
${toolList}

## Collaborator Context
The following is a live snapshot of your collaborator's recent activity. Use this to stay
aware of what they are working on, avoid stepping on their changes, and coordinate effectively.

${collaboratorActivity}

## Behaviour Guidelines
- Be concise but complete. Show code when relevant.
- When making multiple file changes, do them in logical order and summarise at the end.
- If a tool call fails, explain why and suggest a fix rather than retrying silently.
- Proactively flag if you notice potential conflicts with the collaborator's work.
- Format code in fenced blocks with the appropriate language identifier.
`;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function loadHistory(db: Database, userId: number, sessionId: string): MessageParam[] {
  const rows = db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE user_id = ? AND session_id = ?
       ORDER BY id ASC`,
    )
    .all(userId, sessionId) as StoredMessage[];

  return rows.map((row) => ({
    role: row.role,
    content: (() => {
      try {
        return JSON.parse(row.content);
      } catch {
        return row.content;
      }
    })(),
  })) as MessageParam[];
}

function saveMessage(
  db: Database,
  userId: number,
  sessionId: string,
  role: 'user' | 'assistant',
  content: unknown,
): void {
  db.prepare(
    `INSERT INTO chat_messages (user_id, session_id, role, content)
     VALUES (?, ?, ?, ?)`,
  ).run(userId, sessionId, role, typeof content === 'string' ? content : JSON.stringify(content));
}

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

async function dispatchTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
  userId: number,
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string> {
  // Helper to coerce input values
  const s = (key: string, fallback = ''): string =>
    typeof input[key] === 'string' ? (input[key] as string) : fallback;
  const n = (key: string, fallback = 10): number =>
    typeof input[key] === 'number' ? (input[key] as number) : fallback;

  switch (toolName) {
    case 'read_file': {
      const content = await read_file(octokit, owner, repo, s('branch'), s('path'));
      return content;
    }

    case 'write_file': {
      const result = await write_file(
        octokit,
        owner,
        repo,
        s('branch'),
        s('path'),
        s('content'),
        s('commit_message'),
      );
      return JSON.stringify(result);
    }

    case 'list_files': {
      const files = await list_files(octokit, owner, repo, s('path', ''), s('branch', 'main'));
      return JSON.stringify(files, null, 2);
    }

    case 'search_code': {
      const matches = await search_code(octokit, owner, repo, s('query'));
      return JSON.stringify(matches, null, 2);
    }

    case 'check_conflicts': {
      const result = await check_conflicts(
        octokit,
        owner,
        repo,
        s('branch'),
        s('base', 'main'),
      );
      return JSON.stringify(result, null, 2);
    }

    case 'merge_to_main': {
      const result = await merge_to_main(
        octokit,
        owner,
        repo,
        s('branch'),
        s('commit_message'),
      );
      return JSON.stringify(result, null, 2);
    }

    case 'create_pr': {
      const result = await create_pr(
        octokit,
        owner,
        repo,
        s('branch'),
        s('title'),
        s('body'),
        s('base_branch', 'main'),
      );
      return JSON.stringify(result, null, 2);
    }

    case 'get_pr_list': {
      const prs = await get_pr_list(octokit, owner, repo);
      return JSON.stringify(prs, null, 2);
    }

    case 'comment_on_pr': {
      const result = await comment_on_pr(
        octokit,
        owner,
        repo,
        n('pr_number'),
        s('comment'),
      );
      return JSON.stringify(result, null, 2);
    }

    case 'get_diff': {
      const diff = await get_diff(octokit, owner, repo, s('base'), s('head'));
      return JSON.stringify(diff, null, 2);
    }

    case 'get_commit_log': {
      const log = await get_commit_log(octokit, owner, repo, s('branch'), n('n', 10));
      return JSON.stringify(log, null, 2);
    }

    case 'get_collaborator_activity': {
      const activity = await get_collaborator_activity(db, userId, octokit, owner, repo);
      return activity;
    }

    case 'create_issue': {
      const result = await create_issue(octokit, owner, repo, s('title'), s('body'));
      return JSON.stringify(result, null, 2);
    }

    case 'get_issues': {
      const issues = await get_issues(octokit, owner, repo);
      return JSON.stringify(issues, null, 2);
    }

    case 'delete_file': {
      const result = await delete_file(
        octokit,
        owner,
        repo,
        s('branch'),
        s('path'),
        s('commit_message'),
      );
      return JSON.stringify(result, null, 2);
    }

    case 'rename_file': {
      const result = await rename_file(
        octokit,
        owner,
        repo,
        s('branch'),
        s('old_path'),
        s('new_path'),
        s('commit_message'),
      );
      return JSON.stringify(result, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Tools that modify the repo and should trigger broadcast
const REPO_MODIFYING_TOOLS = new Set([
  'write_file',
  'delete_file',
  'rename_file',
  'merge_to_main',
  'create_pr',
]);

// ---------------------------------------------------------------------------
// runAgentTurn — main entry point
// ---------------------------------------------------------------------------

export async function runAgentTurn(
  userId: number,
  sessionId: string,
  userMessage: string,
  db: Database,
  octokit: Octokit,
  owner: string,
  repo: string,
  settings: { agent_name: string; agent_role: string; repo_owner: string; repo_name: string },
  user: { username: string; display_name: string },
  broadcastFn: BroadcastFn,
  streamCallback: StreamCallback,
): Promise<string> {
  const anthropic = getAnthropic();

  // 1. Load history
  const history = loadHistory(db, userId, sessionId);

  // 2. Get fresh collaborator activity
  let collaboratorActivity = 'Collaborator activity unavailable.';
  try {
    collaboratorActivity = await get_collaborator_activity(db, userId, octokit, owner, repo);
  } catch {
    // Non-fatal
  }

  // 3. Build system prompt
  const systemPrompt = buildSystemPrompt(user, settings, collaboratorActivity);

  // 4. Append current user message
  const userMsg: MessageParam = { role: 'user', content: userMessage };
  saveMessage(db, userId, sessionId, 'user', userMessage);

  const messages: MessageParam[] = [...history, userMsg];

  // 5. Agentic loop
  let finalText = '';
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    // Call Claude with streaming
    const stream = await anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8096,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    // Collect streamed content
    let accumulatedText = '';
    const toolUseBlocks: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
      inputJson: string;
    }> = [];
    let currentToolBlock: {
      id: string;
      name: string;
      inputJson: string;
    } | null = null;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolBlock = {
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: '',
          };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          accumulatedText += event.delta.text;
          streamCallback({ type: 'token', content: event.delta.text });
        } else if (event.delta.type === 'input_json_delta' && currentToolBlock) {
          currentToolBlock.inputJson += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolBlock) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(currentToolBlock.inputJson || '{}');
          } catch {
            parsedInput = {};
          }
          toolUseBlocks.push({
            id: currentToolBlock.id,
            name: currentToolBlock.name,
            input: parsedInput,
            inputJson: currentToolBlock.inputJson,
          });
          currentToolBlock = null;
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    const stopReason = finalMessage.stop_reason;

    // Build the assistant message content array for history
    const assistantContent: MessageParam['content'] = [];

    if (accumulatedText) {
      assistantContent.push({ type: 'text', text: accumulatedText });
    }

    for (const tb of toolUseBlocks) {
      assistantContent.push({
        type: 'tool_use',
        id: tb.id,
        name: tb.name,
        input: tb.input,
      });

      // Emit tool_call event
      streamCallback({ type: 'tool_call', name: tb.name, input: tb.input });
    }

    // Save assistant turn to history
    if (assistantContent.length > 0) {
      saveMessage(db, userId, sessionId, 'assistant', assistantContent);
      messages.push({ role: 'assistant', content: assistantContent });
    }

    // If no tool calls, we're done
    if (stopReason !== 'tool_use' || toolUseBlocks.length === 0) {
      finalText = accumulatedText;
      break;
    }

    // 6. Execute tool calls
    const toolResults: ToolResultBlockParam[] = [];

    for (const tb of toolUseBlocks) {
      let resultContent: string;
      let isError = false;

      try {
        resultContent = await dispatchTool(
          tb.name,
          tb.input,
          db,
          userId,
          octokit,
          owner,
          repo,
        );
      } catch (err) {
        resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }

      // Emit tool_result event
      streamCallback({ type: 'tool_result', name: tb.name, result: resultContent });

      // Broadcast if this tool modified the repo
      if (REPO_MODIFYING_TOOLS.has(tb.name) && !isError) {
        broadcastFn(userId, {
          type: 'collaborator_action',
          payload: {
            user: user.username,
            action: tb.name,
            file: (tb.input.path as string | undefined) ?? (tb.input.new_path as string | undefined),
            commit_message: tb.input.commit_message as string | undefined,
            branch: tb.input.branch as string | undefined,
          },
        });

        // Emit a more specific merge broadcast
        if (tb.name === 'merge_to_main') {
          broadcastFn(userId, {
            type: 'collaborator_merge',
            payload: {
              user: user.username,
              merged_at: new Date().toISOString(),
              commit_message: tb.input.commit_message as string,
              files_changed: [],
            },
          });
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tb.id,
        content: resultContent,
        ...(isError ? { is_error: true } : {}),
      });
    }

    // Append tool results as a user turn and continue the loop
    const toolResultMsg: MessageParam = { role: 'user', content: toolResults };
    saveMessage(db, userId, sessionId, 'user', toolResults);
    messages.push(toolResultMsg);
  }

  if (rounds >= MAX_TOOL_ROUNDS && !finalText) {
    finalText = 'Agent reached the maximum number of tool-call rounds. Please refine your request.';
  }

  // Signal completion
  streamCallback({ type: 'done' });

  return finalText;
}
