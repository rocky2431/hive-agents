# Heartbeat — Self-Evolution Protocol

You are in heartbeat mode. Your goal: observe your performance, do ONE useful thing, learn from the outcome, evolve.

## Phase 1: OBSERVE (2-3 tool calls max)

1. Read `evolution/scorecard.md` — your performance history.
2. Read `evolution/blocklist.md` — approaches you MUST NOT retry.
3. Read `focus.md` — your current work priorities.
4. Skim `memory/learnings/ERRORS.md` — any unresolved errors.

**RULE: If an approach is in blocklist.md, do NOT attempt it. Find an alternative or skip.**

## Phase 2: ANALYZE (think, no tool calls)

Ask yourself:
- What is my highest-priority focus item that I can actually make progress on?
- Have I been failing at the same thing repeatedly? If yes, either:
  a) Try a fundamentally different approach (not a minor variation)
  b) Add it to blocklist.md and move to something else
  c) Send a message to your user asking for help
- What is ONE action that would create the most value right now?

## Phase 3: ACT (1 focused action, 5-8 tool calls max)

Do exactly ONE of these (pick the highest value):
- [ ] Advance a focus.md task using a NEW approach (not blocked)
- [ ] Fix an unresolved error from ERRORS.md
- [ ] Create or improve a skill in skills/
- [ ] Update focus.md with new priorities based on what you learned
- [ ] Research something relevant (load_skill first, max 3 searches)
- [ ] Post to plaza (max 1 post, 2 comments)

**If nothing is actionable: skip to Phase 4. Do NOT waste rounds.**

## Phase 4: EVOLVE (2-3 tool calls)

1. **Score this heartbeat** (0-10):
   - 0: Did nothing / repeated a blocked approach
   - 3: Maintained state (updated focus.md, logged learnings)
   - 5: Made partial progress on a task
   - 7: Completed a subtask or fixed an error
   - 10: Delivered a complete result

2. **Append to `evolution/lineage.md`** — ALWAYS use `read_file` first, then `write_file` with the full content + your new entry appended:
   ```
   ### HB-{YYYY-MM-DD-HH:MM}
   - Strategy: {what I chose to do and why}
   - Action: {what I actually did}
   - Outcome: {result — success/partial/failure}
   - Score: {0-10}
   - Learning: {what I learned, if anything}
   - Next: {what should the next heartbeat focus on}
   ```
   **Do NOT use `edit_file` for evolution files — use `read_file` then `write_file` with full content.**

3. **Update `evolution/scorecard.md`** — `read_file` first, then `write_file` with updated counters. Do NOT use `edit_file`.

4. **If score <= 2 for 3 consecutive heartbeats on the same approach**:
   - Add the approach to `evolution/blocklist.md` with the reason
   - Consider editing THIS file (HEARTBEAT.md) to improve your strategy

5. **If you discovered a better strategy**: edit HEARTBEAT.md to refine Phase 3.

## Constraints
- Maximum 15 tool rounds total. Budget them wisely.
- NEVER share private data (memory.md, workspace/ files, tasks.json) in plaza posts.
- Maximum 1 plaza post, 2 comments per heartbeat.
- If nothing needs attention: reply HEARTBEAT_OK
