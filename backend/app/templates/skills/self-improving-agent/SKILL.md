---
name: Self-Improving Agent
description: Continuous self-improvement protocol. Records errors, corrections, and learnings as reusable knowledge. Triggers on operation failures, user corrections, or discovery of better approaches.
tools:
  - write_file
  - read_file
  - execute_code
is_system: true
is_default: true
---

# Self-Improving Agent

Record errors and lessons learned, distill them into persistent knowledge. Important learnings get promoted to core agent files.

## Trigger Conditions

| Situation | Action |
|-----------|--------|
| Command/operation fails | Record to `memory/learnings/ERRORS.md` |
| User corrects you | Record to `memory/learnings/LEARNINGS.md`, category `correction` |
| User needs a capability you lack | Record to `memory/learnings/FEATURE_REQUESTS.md` |
| API/external tool fails | Record to `memory/learnings/ERRORS.md` |
| Your knowledge is outdated | Record to `memory/learnings/LEARNINGS.md`, category `knowledge_gap` |
| Better approach discovered | Record to `memory/learnings/LEARNINGS.md`, category `best_practice` |
| Broadly applicable insight | Promote to `soul.md` or `memory/memory.md` |

## Detection Triggers

**User correction** (-> learning, correction):
- "That's wrong", "Actually it should be...", "That's outdated"

**Knowledge gap** (-> learning, knowledge_gap):
- User provides information you didn't know
- Documentation you referenced is outdated

**Error** (-> error):
- Command returns non-zero exit code
- Exception or stack trace
- Timeout or connection failure

## File Structure

```
memory/
├── memory.md              # Long-term memory (existing)
├── learnings/             # This skill's record directory
│   ├── LEARNINGS.md       # Corrections, knowledge gaps, best practices
│   ├── ERRORS.md          # Command failures, exceptions
│   └── FEATURE_REQUESTS.md # Capabilities users need but you lack
```

The `memory/learnings/` directory is pre-created in the workspace.

## Record Format

### Learning Entry

Append to `memory/learnings/LEARNINGS.md`:

```markdown
## [LRN-YYYYMMDD-XXX] category

**Time**: ISO-8601
**Priority**: low | medium | high | critical
**Status**: pending

### Summary
One sentence describing what was learned

### Details
Full context: what happened, what went wrong, what the correct approach is

### Suggested Action
Specific improvement measures

### Metadata
- Source: conversation | error | user_feedback
- Related file: path/to/file
- Related: LRN-20250110-001 (if connected to existing entry)
---
```

### Error Entry

Append to `memory/learnings/ERRORS.md`:

```markdown
## [ERR-YYYYMMDD-XXX] command_or_tool_name

**Time**: ISO-8601
**Priority**: high
**Status**: pending

### Summary
Brief description of what failed

### Error Message
Actual error output

### Context
- Command/operation attempted
- Input or parameters used

### Suggested Fix
Possible solutions

### Metadata
- Reproducible: yes | no | unknown
- Related file: path/to/file
---
```

## Resolving Entries

After fixing an issue, update the entry:
1. Change `**Status**: pending` to `**Status**: resolved`
2. Add resolution record:

```markdown
### Resolution
- **Resolved at**: 2025-01-16T09:00:00Z
- **Notes**: Brief description of what was done
```

## Promotion to Core Files

When a learning has broad applicability, promote it to permanent knowledge:

| Learning Type | Promotion Target | Example |
|--------------|-----------------|---------|
| Behavior/personality adjustment | `soul.md` (injected every call, 2000 chars) | "Keep replies concise, avoid filler" |
| Current task-related insight | `focus.md` (injected every call, 3000 chars) | "User prefers plan A, API endpoint changed" |
| Long-term valid knowledge | `memory/memory.md` (injected every call, 2000 chars) | "Project uses pnpm, not npm" |
| Tool usage tips | `memory/learnings/LEARNINGS.md` | Keep as-is, don't promote |

### Promotion Criteria

Promote when any of these conditions are met:
- Same issue occurred 3+ times
- Knowledge applies across multiple files/features
- Rule that prevents repeated mistakes

### Promotion Steps

1. **Distill** into a concise rule or fact
2. **Add** to the appropriate section in the target file
3. **Update** original entry status to `promoted`

## Periodic Review

Review `memory/learnings/` at these times:
- Before starting a major new task
- After completing a feature
- When working in an area with historical issues

## Repeated Pattern Detection

Before recording similar content, search first:
1. Search existing entries for similar issues
2. If found, add a cross-reference
3. Increase priority
4. Consider promoting to core knowledge

## Best Practices

1. **Record immediately** — context is freshest right away
2. **Be specific** — future you needs to understand quickly
3. **Include reproduction steps** — especially for errors
4. **Suggest specific fixes** — don't just write "investigate"
5. **Promote proactively** — when in doubt, promote to core files
