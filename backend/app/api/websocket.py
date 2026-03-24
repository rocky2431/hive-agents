"""WebSocket chat endpoint for real-time agent conversations."""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.core.permissions import check_agent_access, is_agent_expired
from app.database import async_session
from app.kernel.contracts import ExecutionIdentityRef
from app.models.agent import Agent
from app.models.audit import ChatMessage
from app.models.llm import LLMModel
from app.runtime.invoker import AgentInvocationRequest, invoke_agent
from app.runtime.session import SessionContext
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


class ConnectionManager:
    """Manage WebSocket connections per agent."""

    def __init__(self):
        # agent_id_str -> list of (WebSocket, session_id_str | None)
        self.active_connections: dict[str, list[tuple]] = {}

    async def connect(self, agent_id: str, websocket: WebSocket, session_id: str = None):
        await websocket.accept()
        if agent_id not in self.active_connections:
            self.active_connections[agent_id] = []
        self.active_connections[agent_id].append((websocket, session_id))

    def disconnect(self, agent_id: str, websocket: WebSocket):
        if agent_id in self.active_connections:
            self.active_connections[agent_id] = [
                (ws, sid) for ws, sid in self.active_connections[agent_id] if ws != websocket
            ]

    async def send_message(self, agent_id: str, message: dict):
        if agent_id in self.active_connections:
            for ws, _sid in self.active_connections[agent_id]:
                await ws.send_json(message)

    def get_active_session_ids(self, agent_id: str) -> list[str]:
        """Return distinct session IDs for all active WS connections of an agent."""
        if agent_id not in self.active_connections:
            return []
        return list(set(sid for _ws, sid in self.active_connections[agent_id] if sid))


manager = ConnectionManager()


from fastapi import Depends
from app.core.security import get_current_user
from app.database import get_db
from app.models.user import User


@router.get("/chat/{agent_id}/history")
async def get_chat_history(
    agent_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return web chat message history for this user + agent."""
    from app.services.chat_message_parts import serialize_chat_message

    await check_agent_access(db, current_user, agent_id)
    conv_id = f"web_{current_user.id}"
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.agent_id == agent_id, ChatMessage.conversation_id == conv_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(200)
    )
    messages = result.scalars().all()
    out = []
    for m in messages:
        out.append(serialize_chat_message(m))
    return out


async def call_llm(
    model: LLMModel,
    messages: list[dict],
    agent_name: str,
    role_description: str,
    fallback_model: LLMModel | None = None,
    agent_id=None,
    user_id=None,
    on_chunk=None,
    on_tool_call=None,
    on_thinking=None,
    on_event=None,
    supports_vision=False,
    session_id: str | None = None,
    memory_messages: list[dict] | None = None,
    memory_context: str = "",
    cancel_event: asyncio.Event | None = None,
    execution_identity: ExecutionIdentityRef | None = None,
) -> str:
    """Call LLM via the unified agent runtime."""
    runtime_messages = [msg for msg in messages if msg.get("role") != "system"]
    runtime_memory_messages = None
    if memory_messages is not None:
        runtime_memory_messages = [msg for msg in memory_messages if msg.get("role") != "system"]

    result = await invoke_agent(
        AgentInvocationRequest(
            model=model,
            fallback_model=fallback_model,
            messages=runtime_messages,
            agent_name=agent_name,
            role_description=role_description,
            agent_id=agent_id,
            user_id=user_id,
            execution_identity=execution_identity,
            on_chunk=on_chunk,
            on_tool_call=on_tool_call,
            on_thinking=on_thinking,
            on_event=on_event,
            supports_vision=supports_vision,
            memory_session_id=session_id,
            memory_messages=runtime_memory_messages,
            memory_context=memory_context,
            cancel_event=cancel_event,
            session_context=SessionContext(
                session_id=session_id,
                source="websocket",
                channel="web",
            ),
        )
    )
    return result.content


@router.websocket("/ws/chat/{agent_id}")
async def websocket_chat(
    websocket: WebSocket,
    agent_id: uuid.UUID,
    token: str = Query(...),
    session_id: str = Query(None),
):
    """WebSocket endpoint for real-time chat with an agent.

    Flow:
    1. Client connects with JWT token + optional session_id as query params
    2. Server accepts immediately so browser onopen fires quickly
    3. Server authenticates and checks agent access
    4. If session_id provided, uses it; otherwise finds/creates the user's latest session
    5. Client sends messages as JSON: {"content": "..."}
    6. Server calls the agent's configured LLM and sends response back
    7. Messages are persisted to chat_messages table under the session
    """
    # Accept immediately so browser sees onopen without waiting for DB setup
    await websocket.accept()

    # Authenticate
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except Exception:
        await websocket.send_json({"type": "error", "content": "Authentication failed"})
        await websocket.close(code=4001)
        return

    # Verify access and load agent + model
    agent_name = ""
    agent_type = ""  # Track agent type for OpenClaw routing
    role_description = ""
    welcome_message = ""
    llm_model = None
    fallback_llm_model = None
    history_messages = []

    try:
        async with async_session() as db:
            logger.info(f"[WS] Looking up user {user_id}")
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user:
                logger.info("[WS] User not found")
                await websocket.send_json({"type": "error", "content": "User not found"})
                await websocket.close(code=4001)
                return

            logger.info(f"[WS] Checking agent access for {agent_id}")
            agent, _ = await check_agent_access(db, user, agent_id)
            # Check agent expiry
            if is_agent_expired(agent):
                await websocket.send_json({"type": "error", "content": "This Agent has expired and is off duty. Please contact your admin to extend its service."})
                await websocket.close(code=4003)
                return
            agent_name = agent.name
            agent_type = agent.agent_type or ""
            role_description = agent.role_description or ""
            welcome_message = agent.welcome_message or ""
            ctx_size = agent.context_window_size or 100
            logger.info(f"[WS] Agent: {agent_name}, type: {agent_type}, model_id: {agent.primary_model_id}, ctx: {ctx_size}")

            # Load the agent's primary model
            if agent.primary_model_id:
                model_result = await db.execute(
                    select(LLMModel).where(LLMModel.id == agent.primary_model_id)
                )
                llm_model = model_result.scalar_one_or_none()
                logger.info(f"[WS] Primary model loaded: {llm_model.model if llm_model else 'None'}")

            # Load fallback model
            if agent.fallback_model_id:
                fb_result = await db.execute(
                    select(LLMModel).where(LLMModel.id == agent.fallback_model_id)
                )
                fallback_llm_model = fb_result.scalar_one_or_none()
                if fallback_llm_model:
                    logger.info(f"[WS] Fallback model loaded: {fallback_llm_model.model}")

            # Config-level fallback: primary missing -> use fallback
            if not llm_model and fallback_llm_model:
                llm_model = fallback_llm_model
                fallback_llm_model = None  # No further fallback available
                logger.info(f"[WS] Primary model unavailable, using fallback: {llm_model.model}")

            # Resolve or create chat session
            from app.models.chat_session import ChatSession
            from sqlalchemy import select as _sel
            from datetime import datetime as _dt, timezone as _tz
            conv_id = session_id
            if conv_id:
                # Validate the session belongs to this agent
                _sr = await db.execute(
                    _sel(ChatSession).where(
                        ChatSession.id == uuid.UUID(conv_id),
                        ChatSession.agent_id == agent_id,
                    )
                )
                _existing = _sr.scalar_one_or_none()
                if not _existing:
                    conv_id = None  # fall through to create
            if not conv_id:
                # Find most recent session for this user+agent
                _sr = await db.execute(
                    _sel(ChatSession)
                    .where(ChatSession.agent_id == agent_id, ChatSession.user_id == user_id)
                    .order_by(ChatSession.last_message_at.desc().nulls_last(), ChatSession.created_at.desc())
                    .limit(1)
                )
                _latest = _sr.scalar_one_or_none()
                if _latest:
                    conv_id = str(_latest.id)
                else:
                    # Create a default session
                    now = _dt.now(_tz.utc)
                    _new_session = ChatSession(
                        agent_id=agent_id, user_id=user_id,
                        title=f"Session {now.strftime('%m-%d %H:%M')}",
                        source_channel="web",
                        created_at=now,
                    )
                    db.add(_new_session)
                    await db.commit()
                    await db.refresh(_new_session)
                    conv_id = str(_new_session.id)
                    logger.info(f"[WS] Created default session {conv_id}")

            try:
                history_result = await db.execute(
                    select(ChatMessage)
                    .where(ChatMessage.agent_id == agent_id, ChatMessage.conversation_id == conv_id)
                    .order_by(ChatMessage.created_at.desc())
                    .limit(20)
                )
                history_messages = list(reversed(history_result.scalars().all()))
                logger.info(f"[WS] Loaded {len(history_messages)} history messages for session {conv_id}")
            except Exception as e:
                logger.warning(f"[WS] History load failed (non-fatal): {e}")
    except Exception as e:
        logger.error(f"[WS] Setup error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        await websocket.send_json({"type": "error", "content": "Setup failed"})
        await websocket.close(code=4002)  # Config error — client should NOT retry
        return

    agent_id_str = str(agent_id)
    if agent_id_str not in manager.active_connections:
        manager.active_connections[agent_id_str] = []
    manager.active_connections[agent_id_str].append((websocket, conv_id))
    logger.info(f"[WS] Ready! Agent={agent_name}")

    # Build conversation context from history
    # IMPORTANT: Include tool_call messages so the LLM maintains tool-calling behavior.
    # Without them, Claude sees user→assistant-text patterns and learns to skip tools.
    conversation: list[dict] = []
    for msg in history_messages:
        if msg.role == "tool_call":
            # Convert stored tool_call JSON into OpenAI-format assistant+tool pair
            try:
                import json as _j_hist
                tc_data = _j_hist.loads(msg.content)
                tc_name = tc_data.get("name", "unknown")
                tc_args = tc_data.get("args", {})
                tc_result = tc_data.get("result", "")
                tc_id = f"call_{msg.id}"  # synthetic tool_call_id
                # Assistant message with tool_calls array
                asst_msg = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": tc_id,
                        "type": "function",
                        "function": {"name": tc_name, "arguments": _j_hist.dumps(tc_args, ensure_ascii=False)},
                    }],
                }
                if tc_data.get("reasoning_content"):
                    asst_msg["reasoning_content"] = tc_data["reasoning_content"]
                conversation.append(asst_msg)
                # Tool result message
                conversation.append({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": str(tc_result)[:500],
                })
            except Exception:
                continue  # Skip malformed tool_call records
        else:
            entry = {"role": msg.role, "content": msg.content}
            if hasattr(msg, 'thinking') and msg.thinking:
                entry["thinking"] = msg.thinking
            conversation.append(entry)

    try:
        # Send welcome message on new session (no history)
        if welcome_message and not history_messages:
            await websocket.send_json({"type": "done", "role": "assistant", "content": welcome_message})

        while True:
            logger.info(f"[WS] Waiting for message from {agent_name}...")
            import asyncio as _aio_idle
            try:
                data = await _aio_idle.wait_for(websocket.receive_json(), timeout=300)  # 5 min idle
            except _aio_idle.TimeoutError:
                logger.info(f"[WS] Idle timeout (5 min) for {agent_name}, closing")
                await websocket.send_json({"type": "info", "content": "Connection closed due to inactivity. Reconnect to continue."})
                await websocket.close(code=1000)
                return
            content = data.get("content", "")
            display_content = data.get("display_content", "")  # User-facing display text
            file_name = data.get("file_name", "")  # Original file name for attachment display
            logger.info(f"[WS] Received: {content[:50]}")

            if not content:
                continue

            # ── Quota checks ──
            try:
                from app.services.quota_guard import (
                    check_conversation_quota, increment_conversation_usage,
                    check_agent_expired, check_agent_llm_quota, increment_agent_llm_usage,
                    QuotaExceeded, AgentExpired,
                )
                await check_conversation_quota(user_id)
                await check_agent_expired(agent_id)
            except QuotaExceeded as qe:
                await websocket.send_json({"type": "done", "role": "assistant", "content": f"⚠️ {qe.message}"})
                continue
            except AgentExpired as ae:
                await websocket.send_json({"type": "done", "role": "assistant", "content": f"⚠️ {ae.message}"})
                continue

            # Add user message to conversation (full LLM context)
            conversation.append({"role": "user", "content": content})

            # Save user message — display_content for history display, content for LLM
            # Prefix with [file:name] if there's a file attachment so history can show it
            saved_content = display_content if display_content else content
            if file_name:
                saved_content = f"[file:{file_name}]\n{saved_content}"
            async with async_session() as db:
                user_msg = ChatMessage(
                    agent_id=agent_id,
                    user_id=user_id,
                    role="user",
                    content=saved_content,
                    conversation_id=conv_id,
                )
                db.add(user_msg)
                # Update session last_message_at + auto-title on first message
                from app.models.chat_session import ChatSession as _CS
                from datetime import datetime as _dt2, timezone as _tz2
                _now = _dt2.now(_tz2.utc)
                _sess_r = await db.execute(
                    select(_CS).where(_CS.id == uuid.UUID(conv_id))
                )
                _sess = _sess_r.scalar_one_or_none()
                if _sess:
                    _sess.last_message_at = _now
                    if not history_messages and _sess.title.startswith("Session "):
                        # Use display_content for title (avoids raw base64/markers)
                        title_src = display_content if display_content else content
                        # Clean up common prefixes from image/file messages
                        clean_title = title_src.replace("[图片] ", "📷 ").replace("[image_data:", "").strip()
                        if file_name and not clean_title:
                            clean_title = f"📎 {file_name}"
                        _sess.title = clean_title[:40] if clean_title else content[:40]
                await db.commit()
            logger.info("[WS] User message saved")

            # ── OpenClaw routing: insert into gateway_messages instead of LLM ──
            if agent_type == "openclaw":
                from app.models.gateway_message import GatewayMessage as GwMsg
                async with async_session() as db:
                    gw_msg = GwMsg(
                        agent_id=agent_id,
                        sender_user_id=user_id,
                        conversation_id=conv_id,
                        content=content,
                        status="pending",
                    )
                    db.add(gw_msg)
                    await db.commit()
                logger.info("[WS] OpenClaw: message queued for gateway poll")
                await websocket.send_json({
                    "type": "done",
                    "role": "assistant",
                    "content": "Message forwarded to OpenClaw agent. Waiting for response..."
                })
                continue

            # Detect task creation intent
            import re
            task_match = re.search(
                r'(?:创建|新建|添加|建一个|帮我建|create|add)(?:一个|a )?(?:任务|待办|todo|task)[，,：：:\\s]*(.+)',
                content, re.IGNORECASE
            )

            # Track thinking content for storage (initialize before condition)
            thinking_content = []

            # Call LLM with streaming
            if llm_model:
                try:
                    logger.info(f"[WS] Calling LLM {llm_model.model} (streaming)...")

                    async def stream_to_ws(text: str):
                        """Send each chunk to client in real-time."""
                        from app.services.chat_message_parts import build_chunk_event

                        await websocket.send_json(build_chunk_event(text))

                    async def tool_call_to_ws(data: dict):
                        """Send tool call info to client and persist completed ones."""
                        from app.services.chat_message_parts import build_tool_call_event

                        await websocket.send_json(build_tool_call_event(data))
                        # Save completed tool calls to DB so they persist in chat history
                        if data.get("status") == "done":
                            try:
                                import json as _json_tc
                                async with async_session() as _tc_db:
                                    tc_msg = ChatMessage(
                                        agent_id=agent_id,
                                        user_id=user_id,
                                        role="tool_call",
                                        content=_json_tc.dumps({
                                            "name": data.get("name", ""),
                                            "args": data.get("args"),
                                            "status": "done",
                                            "result": (data.get("result") or "")[:500],
                                            "reasoning_content": data.get("reasoning_content"),
                                        }),
                                        conversation_id=conv_id,
                                    )
                                    _tc_db.add(tc_msg)
                                    await _tc_db.commit()
                            except Exception as _tc_err:
                                logger.warning(f"[WS] Failed to save tool_call: {_tc_err}")
                    
                    # Track thinking content for storage
                    thinking_content = []
                    
                    async def thinking_to_ws(text: str):
                        """Send thinking chunks to client for collapsible display."""
                        from app.services.chat_message_parts import build_thinking_event

                        thinking_content.append(text)
                        await websocket.send_json(build_thinking_event(text))

                    async def runtime_event_to_ws(data: dict):
                        from app.services.chat_message_parts import (
                            build_active_packs_event,
                            build_compaction_event,
                            build_permission_event,
                        )

                        if data.get("type") == "permission":
                            event_payload = build_permission_event(data)
                        elif data.get("type") == "session_compact":
                            event_payload = build_compaction_event(data)
                        elif data.get("type") == "pack_activation":
                            event_payload = build_active_packs_event(data)
                        else:
                            event_payload = data
                        await websocket.send_json(event_payload)
                        if data.get("type") in {"permission", "session_compact", "pack_activation"}:
                            try:
                                async with async_session() as _event_db:
                                    event_msg = ChatMessage(
                                        agent_id=agent_id,
                                        user_id=user_id,
                                        role="system",
                                        content=json.dumps(data, ensure_ascii=False),
                                        conversation_id=conv_id,
                                    )
                                    _event_db.add(event_msg)
                                    await _event_db.commit()
                            except Exception as _event_err:
                                logger.warning(f"[WS] Failed to save runtime event: {_event_err}")

                    # Run call_llm as a cancellable task
                    cancel_event = asyncio.Event()
                    llm_task = asyncio.create_task(call_llm(
                        llm_model,
                        conversation[-ctx_size:],
                        agent_name,
                        role_description,
                        fallback_model=fallback_llm_model,
                        agent_id=agent_id,
                        user_id=user_id,
                        on_chunk=stream_to_ws,
                        on_tool_call=tool_call_to_ws,
                        on_thinking=thinking_to_ws,
                        on_event=runtime_event_to_ws,
                        supports_vision=getattr(llm_model, 'supports_vision', False),
                        session_id=conv_id,
                        memory_messages=conversation,
                        cancel_event=cancel_event,
                        execution_identity=ExecutionIdentityRef(
                            identity_type="delegated_user",
                            identity_id=user.id,
                            label=f"{user.display_name or user.username} via web",
                        ),
                    ))

                    # Listen for abort while LLM is running
                    while not llm_task.done():
                        try:
                            msg = await asyncio.wait_for(
                                websocket.receive_json(), timeout=0.5
                            )
                            if msg.get("type") == "abort":
                                logger.info("[WS] Abort received, signalling runtime cancel")
                                cancel_event.set()
                                break
                        except asyncio.TimeoutError:
                            continue
                        except WebSocketDisconnect:
                            cancel_event.set()
                            llm_task.cancel()
                            raise

                    assistant_response = await llm_task
                    logger.info(f"[WS] LLM response: {assistant_response[:80]}")

                    # Update last_active_at
                    from datetime import datetime, timezone as tz
                    async with async_session() as _db:
                        from app.models.agent import Agent as AgentModel
                        _ar = await _db.execute(select(AgentModel).where(AgentModel.id == agent_id))
                        _agent = _ar.scalar_one_or_none()
                        if _agent:
                            _agent.last_active_at = datetime.now(tz.utc)
                            await _db.commit()

                    # Increment quota usage
                    try:
                        await increment_conversation_usage(user_id)
                        await increment_agent_llm_usage(agent_id)
                    except Exception as e:
                        logger.debug("Suppressed: %s", e)
                    from app.services.activity_logger import log_activity
                    await log_activity(agent_id, "chat_reply", f"Replied to web chat: {assistant_response[:80]}", detail={"channel": "web", "user_text": content[:200], "reply": assistant_response[:500]})
                except WebSocketDisconnect:
                    raise
                except Exception as e:
                    logger.error(f"[WS] LLM error: {e}")
                    import traceback
                    traceback.print_exc()
                    assistant_response = f"[LLM call error] {str(e)[:200]}"
            else:
                assistant_response = f"⚠️ {agent_name} has no LLM model configured. Please select a model in the agent's Settings tab."

            # If task creation detected, create a real Task record
            if task_match:
                task_title = task_match.group(1).strip()
                if task_title:
                    try:
                        from app.models.task import Task
                        from app.services.task_executor import execute_task
                        import asyncio as _asyncio
                        async with async_session() as db:
                            task = Task(
                                agent_id=agent_id,
                                title=task_title,
                                created_by=user_id,
                                status="pending",
                                priority="medium",
                            )
                            db.add(task)
                            await db.commit()
                            await db.refresh(task)
                            task_id = task.id
                        _asyncio.create_task(execute_task(task_id, agent_id))
                        assistant_response += f"\n\n📋 Task synced to task board: [{task_title}]"
                        logger.info(f"[WS] Created task: {task_title}")
                    except Exception as e:
                        logger.error(f"[WS] Failed to create task: {e}")

            # Add assistant response to conversation
            conversation.append({"role": "assistant", "content": assistant_response})

            # Save assistant message
            async with async_session() as db:
                asst_msg = ChatMessage(
                    agent_id=agent_id,
                    user_id=user_id,
                    role="assistant",
                    content=assistant_response,
                    thinking=''.join(thinking_content) if thinking_content else None,
                    conversation_id=conv_id,
                )
                db.add(asst_msg)
                await db.commit()
            logger.info("[WS] Assistant message saved")

            # Send done signal with final content (for non-streaming clients)
            from app.services.chat_message_parts import build_done_event

            await websocket.send_json(
                build_done_event(
                    assistant_response,
                    thinking="".join(thinking_content) if thinking_content else None,
                )
            )
            logger.info("[WS] Response done sent to client")

    except WebSocketDisconnect:
        logger.info(f"[WS] Client disconnected: {agent_name}")
        manager.disconnect(agent_id_str, websocket)
    except Exception as e:
        logger.error(f"[WS] Error in message loop: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        manager.disconnect(agent_id_str, websocket)
        try:
            await websocket.close(code=1011)
        except Exception as e:
            logger.debug("Suppressed: %s", e)
