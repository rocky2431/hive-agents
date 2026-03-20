---
name: Trigger Management Guide
description: 触发器创建、管理和 Focus 绑定完整指南
tools:
  - set_trigger
  - update_trigger
  - cancel_trigger
  - list_triggers
is_system: true
---

# Trigger Management Guide

## Available Trigger Tools

- `set_trigger` -- schedule future actions, wait for agent or human replies, receive external webhooks
- `update_trigger` -- adjust parameters (e.g. change frequency)
- `cancel_trigger` -- remove triggers when tasks are complete
- `list_triggers` -- see your active triggers

## Supported Trigger Types

| Type | Description | Example |
|------|-------------|---------|
| `cron` | Recurring schedule | Every day at 9am |
| `once` | Fire once at a specific time | Tomorrow at 2pm |
| `interval` | Every N minutes | Every 30 minutes |
| `poll` | HTTP monitoring, detect changes | Check a URL every hour |
| `on_message` | When a specific agent or human replies | Wait for John's reply |
| `webhook` | Receive external HTTP POST | System auto-generates a unique URL |

## Writing Trigger `reason` (CRITICAL)

The `reason` field is the MOST IMPORTANT part of a trigger. When this trigger fires, you will wake up with NO memory of the current conversation. The `reason` is the ONLY context you'll have about what to do and how to do it. Write it as a detailed instruction to your future self:

- **Goal**: What is the objective? Who requested it? Who is the target?
- **Action steps**: Exactly what to do when this trigger fires (e.g. send a message, read a file, check status)
- **Edge cases**: What if the person says "wait 5 minutes"? What if they already completed the task? What if they don't reply? What if they reply with something unexpected?
- **Follow-up**: After completing the action, what triggers should be created/cancelled next?
- **Context**: Any relevant details (message tone, escalation rules, requester preferences)

### Example of a GOOD reason:
> Send a Feishu message to Qinrui every 1 minute, reminding him to send the movie tickets (requested by Ray). Vary the tone each time -- don't repeat the same wording.
> After sending, keep this interval trigger active. Also ensure the on_message trigger wait_qinrui_reply is still listening.
> If Qinrui replies "wait X minutes" -> cancel this interval, set a once trigger X minutes later to resume, and re-create the on_message trigger.
> If Qinrui says it's done -> cancel all related triggers, notify Ray, and mark the focus item as completed.

### Example of a BAD reason (too vague, will cause confusion when waking up):
> Remind Qinrui

## Focus-Trigger Binding (MANDATORY)

- **Before creating any task-related trigger, you MUST first add a corresponding focus item in focus.md.**
  A trigger without a focus item is like an alarm with no purpose -- don't do it.
- Set the trigger's `focus_ref` to the focus item's identifier so they are linked.
- When creating triggers related to a focus item, set `focus_ref` to the item's identifier.
- As the task progresses, adjust the trigger (change frequency, update reason) to match the current status.
- When the focus item is completed (`[x]`), cancel its associated trigger.
- **Exception:** System-level triggers (e.g. heartbeat) do NOT need a focus item.
