"""Conversation summarization — compress old messages to save tokens."""

import logging
import re

logger = logging.getLogger(__name__)

# Provider-specific chars-per-token estimates (tuned for mixed CJK/English)
_CHARS_PER_TOKEN_BY_PROVIDER: dict[str, float] = {
    "anthropic": 3.5,
    "openai": 4.0,
    "azure_openai": 4.0,
    "deepseek": 3.3,
    "qwen": 3.3,
    "gemini": 3.8,
}
CHARS_PER_TOKEN = 3.5  # default fallback


def estimate_tokens(messages: list[dict], *, provider: str = "") -> int:
    """Estimate total tokens across all messages.

    Uses provider-specific chars-per-token ratios for better accuracy.
    """
    cpt = _CHARS_PER_TOKEN_BY_PROVIDER.get(provider.lower(), CHARS_PER_TOKEN) if provider else CHARS_PER_TOKEN
    total_chars = 0
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            total_chars += len(content)
        elif isinstance(content, list):
            # Vision format: array of parts
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    total_chars += len(part.get("text", ""))
                elif isinstance(part, dict) and part.get("type") == "image_url":
                    # Image tokens vary by detail level: ~85 low, ~765 high.
                    detail = "auto"
                    img_data = part.get("image_url", {})
                    if isinstance(img_data, dict):
                        detail = img_data.get("detail", "auto")
                    tokens_for_image = 85 if detail == "low" else 765 if detail == "high" else 300
                    total_chars += int(tokens_for_image * cpt)
        # Tool calls: estimate actual JSON arg size instead of flat 200
        if msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                fn = tc.get("function", {})
                total_chars += len(fn.get("name", "")) + len(fn.get("arguments", "")) + 50
    return int(total_chars / cpt)


async def summarize_conversation(
    messages: list[dict],
    trigger_tokens: int = 4000,
    keep_recent: int = 10,
    model_config: dict | None = None,
    *,
    provider: str = "",
) -> list[dict]:
    """Summarize old messages if conversation exceeds token threshold.

    Args:
        messages: Full conversation message list (user/assistant/tool messages)
        trigger_tokens: Summarize when total tokens exceed this
        keep_recent: Always keep this many recent messages verbatim
        model_config: LLM config for summarization call (optional, uses simple extraction if not provided)
        provider: LLM provider name for accurate token estimation

    Returns:
        Potentially compressed message list with summary prepended
    """
    total_tokens = estimate_tokens(messages, provider=provider)

    if total_tokens <= trigger_tokens:
        return messages  # No summarization needed

    if len(messages) <= keep_recent:
        return messages  # Not enough messages to summarize

    old_messages = messages[:-keep_recent]
    recent_messages = messages[-keep_recent:]

    logger.info(
        "Summarizing conversation: %d messages (%d tokens) → keeping %d recent, summarizing %d old",
        len(messages),
        total_tokens,
        len(recent_messages),
        len(old_messages),
    )

    # Try LLM-powered summarization if model config provided
    if model_config:
        try:
            summary = await _llm_summarize(old_messages, model_config)
            if summary:
                summary_msg = {
                    "role": "system",
                    "content": f"[Previous conversation summary]\n{summary}",
                }
                return [summary_msg] + recent_messages
        except Exception as e:
            logger.warning("LLM summarization failed, falling back to extraction: %s", e)

    # Fallback: extract key points without LLM
    summary = _extract_summary(old_messages)
    summary_msg = {
        "role": "system",
        "content": f"[Previous conversation summary]\n{summary}",
    }
    return [summary_msg] + recent_messages


def _extract_tool_summary(messages: list[dict]) -> str:
    """Extract a compact summary of tool calls from messages."""
    tool_entries: list[str] = []
    for msg in messages:
        # Assistant messages with tool_calls
        if msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                fn = tc.get("function", {})
                name = fn.get("name", "unknown")
                tool_entries.append(f"called {name}")
        # Tool result messages
        if msg.get("role") == "tool":
            content = msg.get("content", "")
            if isinstance(content, str) and content.strip():
                preview = content[:200].replace("\n", " ")
                tool_entries.append(f"  → {preview}")
    if not tool_entries:
        return ""
    # Keep last 15 tool interactions to stay compact
    return "\n".join(tool_entries[-15:])


def _extract_artifacts(messages: list[dict]) -> list[str]:
    patterns = (
        r"(\/[A-Za-z0-9_\-./]+)",
        r"(https?:\/\/[^\s)]+)",
        r"\b([A-Za-z0-9_-]{6,})\b",
    )
    artifacts: list[str] = []
    seen: set[str] = set()
    for msg in messages:
        content = msg.get("content", "")
        if not isinstance(content, str):
            continue
        for pattern in patterns:
            for match in re.findall(pattern, content):
                if not isinstance(match, str):
                    continue
                normalized = match.strip()
                if len(normalized) < 6 or normalized in seen:
                    continue
                if normalized.startswith("http") or normalized.startswith("/") or "_" in normalized:
                    artifacts.append(normalized)
                    seen.add(normalized)
    return artifacts[:8]


def _extract_preferences(messages: list[dict]) -> list[str]:
    preferences: list[str] = []
    seen: set[str] = set()
    hints = ("prefer", "记住", "更喜欢", "不要", "务必", "请用", "以后", "always", "never")
    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content", "")
        if not isinstance(content, str):
            continue
        lowered = content.lower()
        if any(hint in lowered or hint in content for hint in hints):
            pref = content.strip()[:200]
            if pref not in seen:
                preferences.append(pref)
                seen.add(pref)
    return preferences[:5]


def _extract_pending(messages: list[dict]) -> list[str]:
    pending: list[str] = []
    seen: set[str] = set()
    hints = ("next", "pending", "todo", "need to", "下一步", "还需要", "待", "继续")
    for msg in reversed(messages):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", "")
        if not isinstance(content, str):
            continue
        lowered = content.lower()
        if any(hint in lowered or hint in content for hint in hints):
            item = content.strip()[:200]
            if item not in seen:
                pending.append(item)
                seen.add(item)
        if len(pending) >= 4:
            break
    pending.reverse()
    return pending


def _extract_summary(messages: list[dict]) -> str:
    """Extract a state-first snapshot without an LLM."""
    user_asks: list[str] = []
    assistant_answers: list[str] = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not isinstance(content, str) or not content.strip():
            continue
        if role == "user":
            user_asks.append(content[:200])
        elif role == "assistant" and "tool_calls" not in msg:
            assistant_answers.append(content[:300])

    if not user_asks and not assistant_answers:
        return "**Task Ledger:** (unknown)\n**Pending Ledger:** (none captured)"

    task = user_asks[-1] if user_asks else "(unknown)"
    decision_candidates = user_asks[-4:-1]
    if assistant_answers:
        decision_candidates.append(assistant_answers[-1][:120])
    decision_text = "; ".join(item[:120] for item in decision_candidates if item) or "(none captured)"
    tool_summary = _extract_tool_summary(messages) or "(no tool activity captured)"
    artifacts = _extract_artifacts(messages)
    artifact_text = "\n".join(f"- {item}" for item in artifacts) if artifacts else "- (none captured)"
    preferences = _extract_preferences(messages)
    preference_text = "\n".join(f"- {item}" for item in preferences) if preferences else "- (none captured)"
    pending = _extract_pending(messages)
    pending_text = "\n".join(f"- {item}" for item in pending) if pending else "- (none captured)"
    narrative = assistant_answers[-1][:200] if assistant_answers else "(none captured)"

    return "\n".join(
        [
            f"**Task Ledger:** {task}",
            f"**Decision Ledger:** {decision_text}",
            f"**Artifact Ledger:**\n{artifact_text}",
            f"**Tool Ledger:**\n{tool_summary}",
            f"**Preference Ledger:**\n{preference_text}",
            f"**Pending Ledger:**\n{pending_text}",
            f"**Narrative Snapshot:** {narrative}",
        ]
    )


def _extract_summary_from_response(content: str) -> str | None:
    """Extract <summary> content, stripping <analysis> scratchpad.

    The LLM is instructed to use <analysis> as a reasoning scratchpad and
    <summary> for the final output.  Only the <summary> block is persisted
    into context — the analysis is discarded to save tokens.
    """
    if not content:
        return None
    summary_match = re.search(r"<summary>(.*?)</summary>", content, re.DOTALL)
    if summary_match:
        return summary_match.group(1).strip()
    # Fallback: strip <analysis> block if model didn't wrap in <summary>
    stripped = re.sub(r"<analysis>.*?</analysis>", "", content, flags=re.DOTALL).strip()
    return stripped if stripped else content.strip()


# Summarization system prompt — uses <analysis>/<summary> scratchpad pattern.
# The <analysis> block is stripped by _extract_summary_from_response() before
# the summary reaches context, letting the model reason without wasting tokens.
_SUMMARIZE_SYSTEM_PROMPT = """\
CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- Do NOT use read_file, write_file, web_search, execute_code, or ANY other tool.
- You already have all the context you need in the conversation below.
- Tool calls will be REJECTED and will waste your only turn.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
- Session summaries preserve working state so the next turn can continue safely.
- Do NOT rewrite this summary as long-term memory or policy.
- Stable preferences, lessons, and policies can be extracted later into memory and evolution systems.

Your task is to create a detailed summary of the conversation, preserving critical context \
for continuing work without losing state.

First, wrap your detailed analysis in <analysis> tags:
1. Chronologically analyze each message — identify user requests, your approach, and outcomes
2. Note ALL file paths, code snippets, function signatures, and technical decisions
3. Pay special attention to user corrections and feedback
4. Identify errors encountered and how they were resolved

Then provide your final summary in <summary> tags using EXACTLY this format:

**Task Ledger:** [what was being worked on — be specific about the goal and current status]
**Decision Ledger:** [decisions made, user corrections, constraints learned]
**Artifact Ledger:** [file paths, URLs, IDs, resource handles — list each on its own line]
**Code Snapshot:** [key code changes, function signatures, or config values — include short snippets for critical changes]
**Tool Ledger:** [tools called and their key results — focus on outcomes, not individual calls]
**User Messages:** [ALL non-trivial user messages summarized — these are critical for understanding changing intent]
**Preference Ledger:** [stable user preferences or instructions for future behavior]
**Error Ledger:** [errors encountered, root causes, and resolutions]
**Pending Ledger:** [incomplete items and next steps — include direct quotes from recent messages showing where work left off]
**Narrative Snapshot:** [1-2 line recap of the current state]

Be thorough in preserving technical details — code snippets and file paths are more valuable than prose.
Respond in the same language as the conversation.\
"""


async def _llm_summarize(messages: list[dict], model_config: dict) -> str | None:
    """Use LLM to create a detailed summary of old messages.

    Uses <analysis>/<summary> scratchpad pattern: LLM reasons in <analysis>
    tags (stripped before persistence), outputs clean summary in <summary> tags.
    """
    from app.services.llm_client import LLMMessage, create_llm_client

    # Build conversation text with higher fidelity for code context
    conversation_text: list[str] = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")

        if msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                fn = tc.get("function", {})
                name = fn.get("name", "?")
                args_preview = fn.get("arguments", "")[:300]
                conversation_text.append(f"assistant: [called {name}({args_preview})]")
            continue

        if role == "tool":
            if isinstance(content, str) and content.strip():
                conversation_text.append(f"tool_result: {content[:1500]}")
            continue

        if not isinstance(content, str) or not content.strip():
            continue
        if role == "user":
            # Preserve user messages at higher fidelity — they encode intent
            conversation_text.append(f"user: {content[:800]}")
        elif role == "assistant":
            conversation_text.append(f"assistant: {content[:800]}")

    if not conversation_text:
        return None

    text = "\n".join(conversation_text[-40:])

    client = create_llm_client(**model_config)
    try:
        response = await client.stream(
            messages=[
                LLMMessage(role="system", content=_SUMMARIZE_SYSTEM_PROMPT),
                LLMMessage(role="user", content=text),
            ],
            max_tokens=2500,
            temperature=0.3,
        )
        return _extract_summary_from_response(response.content)
    finally:
        await client.close()
