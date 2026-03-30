---
name: create_employee
description: Agent creation guide — skill catalog, trigger design, tool call sequence
tools: [create_digital_employee, discover_resources, web_search, jina_search, jina_read, execute_code]
---

# Create Digital Employee — Guide

## Round 2 Tool Call Sequence

After Round 1 (user described their needs), execute these tool calls in order:

### Step 1: Search MCP marketplace
```
discover_resources(query="[role-relevant keywords in English]", max_results=5)
```
This searches Smithery. Save the server IDs of useful results for `mcp_server_ids`.

### Step 2: Search community skills
Use `web_search` to find skills on skills.sh:
```
web_search(query="site:skills.sh [role-relevant keywords in English]")
```
This searches skills.sh marketplace. If you find useful skills, note them. After agent creation, install them with:
```
execute_code(code="cd [skills_directory] && npx skills add <owner/repo@skill> -y")
```
The skills directory path is returned in the create_digital_employee result.

### Step 3: Match platform skills
Check the catalog below. Select which NON-default skills to add to `skill_names`.

## Platform Skill Catalog

### Default Skills (AUTO-INSTALLED — do NOT pass to skill_names)
These 14 skills are automatically installed for every new agent:
- web-research-guide, trigger-guide, workspace-guide, mcp-installer
- complex-task-executor, find-skills, skill-creator
- proactive-agent, self-improving-agent, skill-vetter
- pdf-generator, docx-generator, xlsx-processor, pptx-generator

### Non-Default Skills (pass to skill_names if needed)
| folder_name | When to add |
|---|---|
| `feishu-integration` | User needs Feishu messaging/docs/calendar |
| `dingtalk-integration` | User needs DingTalk |
| `atlassian-rovo` | User needs Jira/Confluence |

## Capability Matching

| User says... | Add to skill_names | Also do |
|---|---|---|
| "飞书/文档/日历" | `feishu-integration` | Guide channel config |
| "钉钉" | `dingtalk-integration` | Guide channel config |
| "Jira/Confluence" | `atlassian-rovo` | |
| "GitHub/Notion/Slack" | (none) | `discover_resources` to find MCP |
| "搜新闻/研究" | (none — default) | |
| "定时/每天/自动" | (none — default) | Set up triggers! |

## Trigger Design (NOT Heartbeat)

**Heartbeat** = Agent 自省循环（检查广场、探索话题、更新记忆）。所有 Agent 自动开启，保持默认配置。
**Trigger** = 具体定时业务任务。通过 `triggers` 参数创建。

### Cron 速查
| 场景 | expr |
|---|---|
| 每天早上9点 | `0 9 * * *` |
| 工作日9点 | `0 9 * * 1-5` |
| 每周一9点 | `0 9 * * 1` |
| 每6小时 | `0 */6 * * *` |
| 每30分钟 | `*/30 * * * *` |

### Trigger reason 要写得具体可执行
BAD: "搜索新闻"
GOOD: "搜索AI/硬科技最新融资动态（关键词：AI startup funding, 半导体融资）。格式：1.今日头条 2.融资动态 3.技术突破。写入 workspace/daily_brief_YYYY-MM-DD.md，飞书通知创建者。"

## Call create_digital_employee

```json
{
  "name": "VC市场研究员",
  "role_description": "...",
  "personality": "数据驱动，结论先行，标注来源...",
  "boundaries": "不做投资建议，付费内容只引标题...",
  "skill_names": ["feishu-integration"],
  "mcp_server_ids": ["LinkupPlatform/linkup-mcp-server"],
  "permission_scope": "company",
  "heartbeat_enabled": true,
  "heartbeat_interval_minutes": 120,
  "heartbeat_active_hours": "09:00-18:00",
  "triggers": [
    {
      "name": "daily_report",
      "type": "cron",
      "config": {"expr": "0 9 * * *"},
      "reason": "搜索AI融资动态，生成日报..."
    }
  ],
  "welcome_message": "你好！我是你的 VC 市场研究员，负责追踪 AI/硬科技领域融资动态和人才变动。有什么需要我研究的吗？",
  "focus_content": "## 初始任务\n- 搜集本周 AI 领域 Top 10 融资事件\n- 建立竞品监控关键词列表\n- 测试飞书文档写入流程",
  "heartbeat_topics": "- 关注 AI/VC/硬科技 领域最新进展\n- 探索新的数据源和信息渠道\n- 回顾最近的研究发现，寻找深度分析机会"
}
```

### Parameter Guide
| Parameter | Required | Notes |
|---|---|---|
| `name` | **Yes** | 2-100 chars |
| `role_description` | No | Core responsibilities |
| `personality` | No | Role-specific traits |
| `boundaries` | No | Role-specific risks/limits |
| `skill_names` | No | **NON-default only.** 14 defaults auto-install. Pass `[]` if only defaults. |
| `mcp_server_ids` | No | Smithery server IDs from discover_resources |
| `permission_scope` | No | `"company"` or `"self"` |
| `heartbeat_enabled` | No | Default: true |
| `heartbeat_interval_minutes` | No | Default: 120 |
| `heartbeat_active_hours` | No | Default: "09:00-18:00" |
| `triggers` | No | Scheduled cron/interval tasks |
| `welcome_message` | No | Greeting when someone chats with it |
| `focus_content` | No | Initial agenda — what to work on first |
| `heartbeat_topics` | No | Role-specific exploration topics for self-awareness |

## After Creation

1. What works NOW (default skills + installed MCP)
2. What needs setup (channel config: 详情页 → 渠道配置)
3. If community skills found: install with execute_code
4. Suggest first task to try
