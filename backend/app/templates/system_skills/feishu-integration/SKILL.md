---
name: Feishu Integration
description: 飞书/Lark 消息、日历、文档、知识库与表格操作指南
tools:
  - feishu_user_search
  - feishu_calendar_create
  - feishu_calendar_list
  - feishu_calendar_update
  - feishu_calendar_delete
  - feishu_wiki_list
  - feishu_doc_read
  - feishu_sheet_info
  - feishu_sheet_read
  - feishu_base_table_list
  - feishu_base_record_list
  - feishu_task_list
  - feishu_doc_create
  - feishu_doc_append
  - feishu_doc_share
  - send_feishu_message
---

## Pre-installed Feishu Tools

The following tools are available in your toolset. **You MUST call them via the tool-calling mechanism — NEVER describe or simulate their results in text.**

**ABSOLUTE RULE**: If you have not received an actual tool call result, you have NOT performed the action. Never write "Created", "Success", "Event ID: evt_..." or any claim of completion unless you have a REAL tool result to report.

**FEISHU DOCUMENT CREATION RULE — CRITICAL**:
When user asks to create a Feishu document (summarize PDF, write an article, etc.):
1. First call `feishu_doc_create` to create the document and get the real Token and link
2. Then call `feishu_doc_append(document_token="<real_token>", content="...")` to write the content
3. Finally send the user the link **exactly as returned by the tool** — **never construct URLs yourself, never use `{document_token}` placeholders**
4. You may say "Creating Feishu document..." but must immediately call the tool in the same turn

**URL RULES**:
- Both `feishu_doc_create` and `feishu_doc_append` return a access link in their results
- **You MUST send this link to the user as-is** — do not modify, reconstruct, or replace the real token with `{document_token}`

| Tool | Parameters |
|------|-----------|
| `feishu_user_search` | `name` — search colleagues by name -> returns open_id, department. Call this first when you need to find someone. |
| `feishu_calendar_create` | `summary`, `start_time`, `end_time` (ISO-8601 +08:00). No email needed. |
| `feishu_calendar_list` | No required params. Optional: `start_time`, `end_time` (ISO-8601). **Permissions are fixed — always call directly, never skip based on past errors.** |
| `feishu_calendar_update` | `event_id`, fields to update. |
| `feishu_calendar_delete` | `event_id`. |
| `feishu_wiki_list` | `node_token` (from wiki URL: feishu.cn/wiki/**NodeToken**), optional `recursive`(bool). Lists all sub-pages with titles and tokens. |
| `feishu_doc_read` | `document_token`. Supports both regular docx tokens and **wiki node tokens** (auto-converts). |
| `feishu_sheet_info` | `spreadsheet_token` or `spreadsheet_url`. Lists worksheet IDs, titles, row/column counts before you read cells. |
| `feishu_sheet_read` | `spreadsheet_token` or `spreadsheet_url`, optional `sheet_id`, `range`, `value_render_option`. Read worksheet cells after discovery. |
| `feishu_base_table_list` | `base_token`, optional `offset`, `limit`. List Base tables before reading records. |
| `feishu_base_record_list` | `base_token`, `table_id`, optional `view_id`, `offset`, `limit`. Read Base records from one table. |
| `feishu_task_list` | Optional `query`, `complete`, `created_at`, `due_start`, `due_end`, `page_all`, `page_limit`. Lists my Feishu tasks via user identity. |
| `feishu_doc_create` | `title`. Returns real Token and access link, pre-authorized for you. |
| `feishu_doc_append` | `document_token` (real Token from feishu_doc_create), `content` (Markdown format). |
| `feishu_doc_share` | `document_token`, `action`(add/remove/list), `member_names`(name list, auto-lookup), `permission`(view/edit/full_access). |
| `send_feishu_message` | `member_name` or `user_id` or `open_id`, `message`. |

**NEVER**:
- Use `discover_resources` or `import_mcp_server` for any Feishu tool above
- Ask for user email or open_id when you can call `feishu_user_search` to look them up
- Generate a `.ics` file instead of calling `feishu_calendar_create`
- Write a success message without having received a tool result
- Guess sub-page tokens — you MUST use `feishu_wiki_list` to get them
- **Use `{document_token}` placeholders in URLs — you MUST use the real link returned by the tool**
- **Skip tool calls based on past errors — calendar/doc/message tool permissions are fixed, always call directly, never assume "it still fails"**
- Guess worksheet IDs or ranges when a sheet URL/token is available — call `feishu_sheet_info` first
- Guess Base table IDs or names when a Base token is available — call `feishu_base_table_list` first

**When user sends a Feishu wiki link (feishu.cn/wiki/XXX) and asks to read it:**
1. Call `feishu_wiki_list(node_token="XXX")` to get all sub-pages and their tokens.
2. Call `feishu_doc_read(document_token="<node_token>")` for each sub-page to read.
3. **Never say "cannot read sub-pages" — call feishu_wiki_list to get the sub-page list first!**

**When user sends a Feishu Sheets link and asks for spreadsheet data:**
1. Call `feishu_sheet_info(spreadsheet_url="...")` first to discover `sheet_id`.
2. Then call `feishu_sheet_read(...)` with an explicit range whenever possible.
3. If the user only wants a worksheet overview, stop after `feishu_sheet_info`.

**When user asks for Feishu Base data:**
1. Call `feishu_base_table_list(base_token="...")` first.
2. Pick the target `table_id`.
3. Call `feishu_base_record_list(...)` to read records.

**When user asks about their Feishu tasks:**
1. Call `feishu_task_list(...)`.
2. Remember this path requires CLI user auth, not bot-only auth.

**When user asks to message a colleague by name:**
- Just call `send_feishu_message(member_name="John", message="...")` — it auto-searches.
- Or use `open_id` directly if you already have it from `feishu_user_search`.

**When user asks to invite a colleague to a calendar event:**
- Use `attendee_names=["John"]` in `feishu_calendar_create` — names are resolved automatically.
- Or use `attendee_open_ids=["ou_xxx"]` if you already have the open_id.
