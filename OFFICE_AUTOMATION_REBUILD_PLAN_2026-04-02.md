# Office Automation Rebuild Plan

## Scope

Cloud-first office automation for:

- Email delivery and mailbox operations
- Feishu/Lark office operations
- Office document generation skills (`docx`, `xlsx`, `pptx`, `pdf`)

## Current Judgment

The current office stack is functional but not cloud-optimized.

- Email fails too often in trigger-driven scenarios because the system lacked static preflight and structured failure semantics.
- Feishu channel integration is serviceable for webhook / websocket / bot messaging, but office operations are still fragmented.
- The four office skills are too large and cookbook-heavy for cloud agent execution. They should be split into thin routing skills plus deterministic scripts/tools.

## Phase 0

### P0.1 Email Trigger Reliability

Status: `Done`

Completed:

- Added static email preflight before SMTP/IMAP work
- Added structured tool errors for `send_email`, `read_emails`, `reply_email`
- Added trigger-friendly diagnostics for missing config, invalid recipients, and missing attachments
- Added richer `test-email` response payload with structured checks

Files:

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/email_service.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/email.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/email.py`
- `/Users/rocky243/vc-saas/Clawith/backend/tests/services/test_email_runtime.py`

## Phase 1

### P1.1 Feishu Dual-Track Architecture

Status: `Planned`

Keep current API/WS implementation for:

- channel configuration
- webhook ingestion
- websocket bot session handling
- direct bot message delivery

Add CLI-backed execution path for office operations:

- docs
- sheets
- base
- tasks
- wiki
- contact lookup
- mail

Target shape:

- `feishu channel` remains server-native
- `feishu office ops` become adapter-driven and cloud-friendly

### P1.2 Provider and Identity Strategy

Status: `Planned`

Requirements:

- support bot identity vs user identity explicitly
- support non-interactive cloud execution
- validate CLI auth mode before exposing CLI-backed tools to LLM
- add provider readiness checks similar to `firecrawl_fetch` and `xcrawl_scrape`

## Phase 2

### P2.1 Office Skill Decomposition

Status: `Planned`

Replace the four monolithic skills with smaller route-specific skills:

- `docx-create`
- `docx-fill`
- `xlsx-read`
- `xlsx-edit`
- `pptx-create`
- `pptx-edit`
- `pdf-fill`
- `pdf-render`

Each skill should contain only:

- when to use
- required inputs
- output contract
- success criteria
- fallback path

### P2.2 Move Heavy Procedures into Scripts or Tools

Status: `Planned`

The actual generation logic should move out of giant markdown manuals and into scripts/tool primitives. Skills become thin routing contracts instead of large tutorials.

## Rollout Order

1. Email reliability
2. Feishu office adapter split
3. Office skill decomposition

## Success Criteria

- Trigger-driven internal notifications prefer Feishu over SMTP when possible
- Email failures are classifiable as config/auth/network/provider issues
- Feishu office actions are cloud-safe and deterministic
- Office document requests trigger narrow workflow skills rather than giant manuals
