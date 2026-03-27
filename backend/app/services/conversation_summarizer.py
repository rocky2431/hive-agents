"""Conversation summarization — compress old messages to save tokens."""

import logging

logger = logging.getLogger(__name__)

# Rough chars-per-token estimate (conservative for CJK)
CHARS_PER_TOKEN = 3.3


def estimate_tokens(messages: list[dict]) -> int:
    """Estimate total tokens across all messages."""
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
        # Tool calls add some overhead
        if msg.get("tool_calls"):
            total_chars += 200 * len(msg["tool_calls"])
    return int(total_chars / CHARS_PER_TOKEN)


async def summarize_conversation(
    messages: list[dict],
    trigger_tokens: int = 4000,
    keep_recent: int = 10,
    model_config: dict | None = None,
) -> list[dict]:
    """Summarize old messages if conversation exceeds token threshold.

    Args:
        messages: Full conversation message list (user/assistant/tool messages)
        trigger_tokens: Summarize when total tokens exceed this
        keep_recent: Always keep this many recent messages verbatim
        model_config: LLM config for summarization call (optional, uses simple extraction if not provided)

    Returns:
        Potentially compressed message list with summary prepended
    """
    total_tokens = estimate_tokens(messages)

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


def _extract_summary(messages: list[dict]) -> str:
    """Extract structured summary without LLM — keep user requests and assistant conclusions."""
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
        return "**Current Task:** (unknown)\n**Pending:** (none captured)"

    task = user_asks[-1] if user_asks else "(unknown)"
    lines = [f"**Current Task:** {task}"]
    if len(user_asks) > 1:
        earlier = "; ".join(u[:80] for u in user_asks[-4:-1])
        lines.append(f"**Key Decisions:** {earlier}")
    if assistant_answers:
        last_answer = assistant_answers[-1][:200]
        lines.append(f"**Important Context:** {last_answer}")
    return "\n".join(lines)


async def _llm_summarize(messages: list[dict], model_config: dict) -> str | None:
    """Use LLM to create a concise summary of old messages."""
    from app.services.llm_client import LLMMessage, create_llm_client

    # Build a condensed version of the conversation for the summarizer
    conversation_text = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not isinstance(content, str) or not content.strip():
            continue
        if role in ("user", "assistant") and "tool_calls" not in msg:
            conversation_text.append(f"{role}: {content[:500]}")

    if not conversation_text:
        return None

    text = "\n".join(conversation_text[-20:])  # At most 20 messages

    client = create_llm_client(**model_config)
    try:
        response = await client.stream(
            messages=[
                LLMMessage(
                    role="system",
                    content=(
                        "Summarize this conversation into a structured snapshot. "
                        "Use EXACTLY this format (keep headers, fill in content, omit empty sections):\n\n"
                        "**Current Task:** [what was being worked on]\n"
                        "**Key Decisions:** [decisions made, preferences expressed]\n"
                        "**Files/Resources:** [file paths, URLs, IDs mentioned]\n"
                        "**Pending:** [incomplete items, next steps]\n"
                        "**Important Context:** [corrections, constraints, user preferences]\n\n"
                        "Be concise — each field 1-2 lines max. "
                        "Respond in the same language as the conversation."
                    ),
                ),
                LLMMessage(role="user", content=text),
            ],
            max_tokens=500,
            temperature=0.3,
        )
        return response.content
    finally:
        await client.close()
