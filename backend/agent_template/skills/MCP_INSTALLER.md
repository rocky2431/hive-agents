# MCP Tool Installer

## When to Use This Skill
Use this skill when a user wants to add a new tool or integration (e.g., Gmail, Notion, Brave Search, GitHub, Slack, etc.) that isn't currently available but can be imported from the MCP registry.

---

## Step-by-Step Protocol

### Step 1 — Search first
```
discover_resources(query="<what the user wants>", max_results=5)
```
Show the results and let the user pick. Note the `ID` field (e.g. `anthropic/brave-search`).

### Step 2 — Check if config is required
Look at the tool's homepage or description for required parameters (API keys, tokens, etc.).
- **Remote tools** (🌐): can be imported directly, but often still need API keys
- **Local tools** (💻): require local installation — inform the user these cannot be imported automatically

### Step 3 — Ask for required config (if any)
Ask the user clearly for any required credential. Example:
> "To import Brave Search, I need your Brave API key. You can get it at: https://api.search.brave.com/ — please share it and I'll configure the tool immediately."

**Important rules:**
- Ask for ONE credential at a time
- Never repeat the key back in your response after receiving it
- Do NOT ask the user to "go to Settings" — handle it directly in chat

### Step 4 — Import with config
Once you have the key:
```
import_mcp_server(
  server_id="<qualified_name>",
  config={"api_key": "<the key they provided>"}
)
```
The key is passed as a function parameter and stored securely in the database. It will NOT appear in your response.

### Step 5 — Confirm and demonstrate
After successful import, confirm the tool is available and offer an immediate test:
> "✅ Brave Search is now installed and configured. Want me to try a search right now?"

---

## Common Config Parameter Names by Tool Type

| Tool Type | Common Config Keys |
|---|---|
| Search APIs | `api_key`, `subscription_key` |
| Email (Gmail, Outlook) | `access_token`, `client_id`, `client_secret` |
| GitHub | `token`, `personal_access_token` |
| Notion | `api_key`, `integration_token` |
| Slack | `bot_token` |
| Database tools | `connection_string`, `host`, `port`, `username`, `password` |
| Weather APIs | `api_key` |

> **When unsure**, tell the user the tool's homepage URL and ask them to check the "required configuration" section, then come back with the values.

---

## Handling Config Update Requests
If the user wants to update an existing tool's API key (e.g., key expired):
```
import_mcp_server(server_id="<same server_id>", config={"api_key": "<new key>"})
```
This will update the existing tool's config without creating a duplicate.

---

## What NOT to Do
- ❌ Don't tell users to go to the Tools settings page to enter keys — do it here
- ❌ Don't echo API keys back to users in your response
- ❌ Don't skip the search step — always verify the server exists before importing
- ❌ Don't import local-only tools (without remote support) — inform users instead
