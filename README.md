# DuoCode

Collaborative AI workspace. Pair-program with Claude while staying in sync with your GitHub repository — live push notifications, conflict detection, PR management, and an AI agent that can read, write, and commit code on your behalf.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [GitHub OAuth App Registration](#github-oauth-app-registration)
5. [GitHub Webhook Configuration](#github-webhook-configuration)
6. [Local Setup](#local-setup)
7. [Running the App](#running-the-app)
8. [Project Structure](#project-structure)
9. [Environment Variables Reference](#environment-variables-reference)

---

## Features

- **AI Pair Programmer** — Claude (claude-3-5-sonnet) can read files, write code, create PRs, check for merge conflicts, and comment on issues directly in your repo.
- **Live Collaborator Feed** — GitHub webhooks stream push events, PR merges, and branch activity to every connected browser tab in real time via WebSockets.
- **Conflict Detection** — Before merging, the agent checks which files would conflict and presents a human-readable diff.
- **Workspace Settings** — Per-user configuration: which repo to watch, agent persona name/role, accent colour.
- **GitHub OAuth** — One-click sign-in; no passwords stored.

---

## Architecture

```
DuoCode/
├── shared/          TypeScript types shared between client and server
├── client/          React + Vite SPA  (port 5173)
└── server/          Express + ws API  (port 3001)
                       ├── GitHub OAuth flow
                       ├── Webhook receiver  POST /webhooks/github
                       ├── Agent SSE stream  POST /api/agent/message
                       └── SQLite via better-sqlite3
```

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 20 LTS |
| npm | 10 |
| Git | any recent |

You also need:
- An **Anthropic API key** (https://console.anthropic.com/settings/keys)
- A **GitHub account** to create an OAuth App and (optionally) a webhook

---

## GitHub OAuth App Registration

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   (or https://github.com/settings/applications/new)

2. Fill in the form:

   | Field | Value |
   |-------|-------|
   | Application name | DuoCode (local) |
   | Homepage URL | `http://localhost:5173` |
   | Authorization callback URL | `http://localhost:3001/auth/github/callback` |

3. Click **Register application**.

4. On the next page, note the **Client ID** and click **Generate a new client secret**.

5. Copy both values into your `.env` file:
   ```
   GITHUB_CLIENT_ID=<your_client_id>
   GITHUB_CLIENT_SECRET=<your_client_secret>
   ```

---

## GitHub Webhook Configuration

Webhooks allow DuoCode to receive live push/PR events from GitHub.
During local development, use **ngrok** or **smee.io** to expose your local server.

### Using smee.io (easiest)

1. Visit https://smee.io and click **Start a new channel**. Copy the URL (e.g. `https://smee.io/abc123`).

2. Install the smee client:
   ```bash
   npm install --global smee-client
   ```

3. In a separate terminal, proxy events to your local server:
   ```bash
   smee --url https://smee.io/abc123 --target http://localhost:3001/webhooks/github
   ```

4. In your GitHub repo: **Settings → Webhooks → Add webhook**

   | Field | Value |
   |-------|-------|
   | Payload URL | `https://smee.io/abc123` |
   | Content type | `application/json` |
   | Secret | *(same value as `GITHUB_WEBHOOK_SECRET` in your .env)* |
   | Events | "Send me everything" or select: Pushes, Pull requests, Issues |

5. Click **Add webhook**. GitHub sends a ping — check the smee dashboard for a green tick.

### Using ngrok

```bash
ngrok http 3001
# Use the https://xxxx.ngrok.io URL as the webhook Payload URL
```

---

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/your-org/duocode.git
cd duocode

# 2. Install all workspace dependencies
npm install

# 3. Copy the example environment file and fill in your values
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY, GITHUB_* values, etc.

# 4. Build the shared types package (required before first run)
npm run build:shared
```

---

## Running the App

### Development (hot-reload)

```bash
npm run dev
```

This runs both the Vite dev server (client, port **5173**) and the Express server (port **3001**) concurrently. Changes to client files reload instantly; server files restart via tsx watch.

### Production build

```bash
npm run build          # builds shared → client → server
node server/dist/index.js
```

The Express server in production serves the compiled Vite SPA from `client/dist`.

---

## Project Structure

```
DuoCode/
├── .env.example
├── .gitignore
├── package.json               root monorepo (npm workspaces)
├── tsconfig.json              base TS config
│
├── shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── index.ts           all shared types (User, AgentMessage, WSEvent …)
│
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── components/        React UI components
│       ├── contexts/          React context providers
│       ├── hooks/             custom hooks (useWebSocket, useAgent …)
│       ├── styles/            global CSS
│       └── utils/             API client helpers
│
└── server/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts           Express entry point
        ├── agent/             Claude agent logic & tool definitions
        ├── db/                SQLite schema & query helpers
        ├── middleware/         auth, error handling
        ├── routes/            Express routers
        └── utils/             crypto, GitHub helpers
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `GITHUB_CLIENT_ID` | Yes | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | OAuth App client secret |
| `GITHUB_WEBHOOK_SECRET` | Yes | HMAC secret for verifying webhook payloads |
| `SESSION_SECRET` | Yes | Express-session signing secret (≥32 chars) |
| `PORT` | No | HTTP server port (default: 3001) |
| `DATABASE_PATH` | No | Path to SQLite file (default: `./server/duocode.db`) |
| `CLIENT_ORIGIN` | No | CORS allowed origin (default: `http://localhost:5173`) |

---

## License

MIT
