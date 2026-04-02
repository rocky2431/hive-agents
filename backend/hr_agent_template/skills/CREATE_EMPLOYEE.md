---
name: create_employee
description: Agent hiring guide — blueprint-first creation, builtin-first capability routing, and explicit setup warnings
tools: [preview_agent_blueprint, create_digital_employee, discover_resources, search_clawhub, web_search, web_fetch, firecrawl_fetch, execute_code]
---

# Create Digital Employee — Blueprint Guide

## Goal

Do not run a long scripted interview. Your job is to:

1. Clarify the role
2. Route capabilities with builtin/default-first logic
3. Produce a clean blueprint preview
4. Create the agent only after confirmation

## Step 1 — Build the Blueprint

Collect just enough information to fill:

- `name`
- `role_description`
- `primary_users`
- `core_outputs`
- `personality`
- `boundaries`
- `permission_scope`
- `skill_names`
- `mcp_server_ids`
- `clawhub_slugs`
- `triggers`
- `welcome_message`
- `focus_content`
- `heartbeat_topics`

If the user is unsure, decide sensible defaults and continue.

## Step 2 — Route Capabilities Correctly

### Builtin/default first

Use builtin/default capabilities first for:

- research
- reports
- document workflows
- scheduling
- workspace automation
- most office flows already supported by platform

### Add non-default platform skills when clearly needed

| User need | Prefer |
|---|---|
| 飞书消息 / 文档 / 表格 / Base / Tasks | `feishu-integration` |
| 钉钉 | `dingtalk-integration` |
| Jira / Confluence | `atlassian-rovo` |

If the user forgets to name one of these obvious platform skills, add it yourself in the blueprint. Do not wait for the user to discover it manually.

### Use MCP only when builtin/default is insufficient

Only call:
```text
discover_resources(query="...")
```
when the requested external system is not already covered by builtin tools or existing platform skills.

### Use ClawHub only as a last extension path

Only call:
```text
search_clawhub(query="...")
```
when builtin/default skills and MCP do not give a clean path.

## Step 3 — Preview Before Create

Always call:

```text
preview_agent_blueprint(...)
```

Then present:

- Mission
- Users
- Core outputs
- Operating style
- Ready now
- Recommended extra skills
- Will install
- Needs setup after creation

If the preview contains setup debt, say it clearly.

## Step 4 — Create

Only after confirmation call:

```text
create_digital_employee(...)
```

## Prompting Guidance

### Good questions

- “这个 agent 最核心要负责什么？”
- “谁会使用它，只有你还是整个团队？”
- “它的产出应该是什么样？日报、文档、表格、消息推送，还是别的？”
- “这个 agent 最主要服务谁？你自己、团队、还是某个固定角色？”
- “哪些外部系统是真的必须连，不连就做不了？”
- “创建后第一件事要做什么？”

### Bad behavior

- Don’t force a 5-round script
- Don’t ask about marketplace tools before clarifying the role
- Don’t recommend MCP by default
- Don’t hide setup requirements

## Output Standard

When summarizing the plan, keep it short and decision-oriented:

- `Role`
- `Users`
- `Core outputs`
- `Capabilities ready now`
- `Capabilities to install`
- `Manual setup still required`
- `First mission after creation`
