# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Clawith is an open-source **multi-agent collaboration platform** — enterprise "digital employees" with persistent identity, long-term memory, private workspaces, and autonomous trigger-driven execution. Built with FastAPI (Python) backend + React 19 (TypeScript) frontend.

Version is tracked in the root `VERSION` file (shared by both frontend and backend).

## Development Commands

### First-Time Setup
```bash
bash setup.sh           # Production: env, PostgreSQL, backend venv, frontend npm, DB seed
bash setup.sh --dev     # Also installs pytest, ruff, and dev tools
```

### Start/Stop Services
```bash
bash restart.sh         # Stops old processes, starts backend(:8008) + frontend(:3008)
# Frontend: http://localhost:3008
# Backend:  http://localhost:8008
```

### Backend (cd backend/)
```bash
source .venv/bin/activate                    # Activate Python venv (created by setup.sh)
uvicorn app.main:app --host 0.0.0.0 --port 8008 --reload  # Dev server

# Lint
ruff check app/ --fix && ruff format app/

# Tests
pip install -e ".[dev]"
pytest                                       # All tests
pytest tests/test_foo.py -v                  # Single test
pytest tests/test_foo.py::test_bar -v        # Single test case

# Database migrations
alembic upgrade head                         # Apply all migrations
alembic revision --autogenerate -m "desc"    # Create new migration
alembic heads                                # Check for multiple heads (must be single)
```

### Frontend (cd frontend/)
```bash
npm run dev              # Vite dev server on :3008 (proxies /api→:8008, /ws→ws://:8008)
npm run build            # tsc + vite build → dist/
npm run preview          # Serve built dist locally
```

### Docker
```bash
cp .env.example .env
docker compose up -d              # Full stack (postgres + redis + backend + frontend → :3008)
docker compose up -d --build      # Rebuild after code changes
```

## Architecture

```
Frontend (React 19 + Vite)
    ↓ /api proxy (:3008 → :8008)
Backend (FastAPI + SQLAlchemy async)
    ↓
PostgreSQL (asyncpg) + Redis
```

### Backend Structure (`backend/app/`)

| Directory | Purpose |
|-----------|---------|
| `api/` | 33 FastAPI router modules (each is a domain: agents, auth, chat, enterprise, triggers, channels...) |
| `models/` | 23 SQLAlchemy ORM models (all async, tenant-scoped) |
| `services/` | 38 business logic services (agent execution, LLM client, trigger daemon, channel integrations) |
| `core/` | Security, permissions, Redis pub/sub, middleware |
| `schemas/` | Pydantic request/response validation |
| `config.py` | Pydantic Settings (loads from `.env`) |
| `database.py` | Async SQLAlchemy engine + session factory |
| `main.py` | App entry point — lifespan startup seeds DB, starts trigger daemon + channel WebSocket managers |

All routers are mounted under `/api` prefix. Health check: `GET /api/health`.

**Key services:**
- `agent_tools.py` — file-based workspace tools the agent calls (read/write/search/task management)
- `llm_client.py` — unified LLM client (OpenAI, Anthropic, OpenAI-compatible APIs)
- `trigger_daemon.py` — background process evaluating cron/interval/poll/webhook/on_message triggers
- `mcp_client.py` — Model Context Protocol client for runtime tool discovery
- `quota_guard.py` — token usage and message quota enforcement

**Agent data:** Each agent gets a filesystem directory (`backend/agent_data/<agent-uuid>/`) containing `soul.md`, `memory.md`, skills, and workspace files.

### Frontend Structure (`frontend/src/`)

| Directory | Purpose |
|-----------|---------|
| `pages/` | 11 route pages (Login, Layout, Dashboard, Plaza, AgentCreate, AgentDetail, Chat, EnterpriseSettings, etc.) |
| `components/` | 5 shared components (FileBrowser, MarkdownRenderer, ConfirmModal, PromptModal, ErrorBoundary) |
| `services/api.ts` | Centralized HTTP client — all API calls go through `request<T>()` with JWT auth |
| `stores/index.ts` | Zustand stores — `useAuthStore` (user/token) + `useAppStore` (sidebar/selection) |
| `types/index.ts` | Core TypeScript interfaces (User, Agent, Task, ChatMessage) |
| `i18n/` | i18next with `en.json` + `zh.json` — **both must be updated** for any UI text |
| `utils/theme.ts` | Accent color palette generator + dark/light theme system |
| `index.css` | Full design system (Linear-style dark theme, CSS custom properties) |

**Data fetching:** TanStack React Query 5 for server state; Zustand for client-only UI state.
**Routing:** React Router 7 with protected routes (redirect to `/login` without token). Default route redirects to `/plaza`.

**Path alias:** `@/` maps to `src/` in both Vite and TypeScript configs.

## Critical Conventions

### Multi-Tenancy
Every entity is company/tenant-scoped. All queries must filter by `tenant_id`. The first registered user becomes platform admin.

### Alembic Migrations
- Always check `alembic heads` before creating a new migration — **must be a single head**
- The `main.py` lifespan also applies column patches via `ALTER TABLE IF NOT EXISTS` for backwards compatibility
- `entrypoint.sh` runs `alembic upgrade head` on container start

### i18n
All user-facing text must have entries in both `frontend/src/i18n/en.json` and `zh.json`. Use `t('key')` from `useTranslation()`.

### Agent Types
- **Native** — uses platform-configured LLM models directly
- **OpenClaw** — remote bot running via gateway (Docker container)

### Autonomy Levels
L1 (free action), L2 (some approval needed), L3 (all actions require human approval). Managed by `autonomy_service.py`.

### Channel Integrations
Feishu/Lark, Discord, Slack, DingTalk, WeChat Work, Microsoft Teams — each has its own router in `api/` and streaming service in `services/`. Channel configs are per-agent.

### Environment Variables
Key vars in `.env` (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string (must include `?ssl=disable` for local dev)
- `REDIS_URL` — Redis connection
- `SECRET_KEY`, `JWT_SECRET_KEY` — security keys
- `AGENT_DATA_DIR` — agent workspace root (default: `~/.clawith/data/agents` local, `/data/agents` in Docker)
- `JINA_API_KEY` — for web search/read tools (optional, works without but rate-limited)
- `FEISHU_APP_ID`, `FEISHU_APP_SECRET` — Feishu SSO (optional)

### Ports
| Service | Port |
|---------|------|
| Frontend (dev) | 3008 |
| Backend (dev) | 8008 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| Frontend (Docker) | 3008 (configurable via `FRONTEND_PORT`) |

### Ruff Config
Backend uses ruff with `target-version = "py311"`, `line-length = 120`.
