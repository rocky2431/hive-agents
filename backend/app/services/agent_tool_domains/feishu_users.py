"""Feishu users — user search and contacts cache management."""

import logging
import uuid

from app.services.agent_tool_domains.feishu_helpers import _get_feishu_token

logger = logging.getLogger(__name__)


async def _feishu_user_search(agent_id: uuid.UUID, arguments: dict) -> str:
    """Search for colleagues in the Feishu directory by name.

    Strategy:
    1. Search local contacts cache (populated when anyone messages the bot).
    2. Fall back to Contact v3 GET /users/{open_id} if we find a match by email.
    The cache is populated by feishu.py each time a message sender is resolved.
    """
    import json as _json
    import pathlib as _pl

    name = (arguments.get("name") or "").strip()
    if not name:
        return "❌ Missing required argument 'name'"

    creds = await _get_feishu_token(agent_id)
    if not creds:
        return "❌ Agent has no Feishu channel configured."
    _, token = creds

    # ── Load local contacts cache ─────────────────────────────────────────────
    _cache_file = _pl.Path(f"/data/workspaces/{agent_id}/feishu_contacts_cache.json")
    _cached_users: list[dict] = []
    try:
        if _cache_file.exists():
            _raw = _json.loads(_cache_file.read_text())
            _cached_users = _raw.get("users", [])
    except Exception as e:
        logger.debug("Suppressed: %s", e)

    name_lower = name.lower()

    def _matches(u: dict) -> bool:
        return (
            name_lower in (u.get("name") or "").lower()
            or name_lower in (u.get("en_name") or "").lower()
        )

    matched = [u for u in _cached_users if _matches(u)]

    if matched:
        lines = [f"🔍 找到 {len(matched)} 位匹配「{name}」的用户：\n"]
        for u in matched:
            open_id = u.get("open_id", "")
            user_id = u.get("user_id", "")
            display_name = u.get("name", "")
            en_name = u.get("en_name", "")
            email = u.get("email", "")
            lines.append(f"• **{display_name}**{'（' + en_name + '）' if en_name else ''}")
            if user_id:
                lines.append(f"  user_id: `{user_id}`")
            if open_id:
                lines.append(f"  open_id: `{open_id}`")
            if email:
                lines.append(f"  邮箱: {email}")
        return "\n".join(lines)

    # ── Resolve agent tenant_id for scoped queries ─────────────────────────────
    _tenant_id = None
    try:
        from app.database import async_session as _async_session
        from sqlalchemy import select as _sa_select
        from app.models.agent import Agent as _Agent
        async with _async_session() as _db:
            _agent_r = await _db.execute(_sa_select(_Agent.tenant_id).where(_Agent.id == agent_id))
            _tenant_id = _agent_r.scalar_one_or_none()
    except Exception as e:
        logger.debug("Suppressed tenant lookup: %s", e)

    # ── Cache miss: try OrgMember table first (has user_id from org sync) ──────
    try:
        from app.database import async_session as _async_session
        from sqlalchemy import select as _sa_select
        from app.models.org import OrgMember as _OrgMember
        _om_query = _sa_select(_OrgMember).where(_OrgMember.name.ilike(f"%{name}%"))
        if _tenant_id:
            _om_query = _om_query.where(_OrgMember.tenant_id == _tenant_id)
        async with _async_session() as _db:
            _r = await _db.execute(_om_query)
            _org_members = _r.scalars().all()
        if _org_members:
            lines = [f"🔍 从通讯录找到 {len(_org_members)} 位匹配「{name}」的用户：\n"]
            for _om in _org_members:
                lines.append(f"• **{_om.name}**")
                if _om.feishu_user_id:
                    lines.append(f"  user_id: `{_om.feishu_user_id}`")
                if _om.feishu_open_id:
                    lines.append(f"  open_id: `{_om.feishu_open_id}`")
                if _om.email:
                    lines.append(f"  邮箱: {_om.email}")
                if _om.department_path:
                    lines.append(f"  部门: {_om.department_path}")
            return "\n".join(lines)
    except Exception as e:
        logger.debug("Suppressed: %s", e)
    try:
        from app.database import async_session as _async_session
        from sqlalchemy import select as _sa_select
        from app.models.user import User as _User
        _user_query = _sa_select(_User).where(_User.display_name.ilike(f"%{name}%"))
        if _tenant_id:
            _user_query = _user_query.where(_User.tenant_id == _tenant_id)
        async with _async_session() as _db:
            _r = await _db.execute(_user_query)
            _platform_users = _r.scalars().all()
        for _pu in _platform_users:
            _uid = getattr(_pu, "feishu_user_id", None)
            _oid = getattr(_pu, "feishu_open_id", None)
            if _uid or _oid:
                result_lines = [f"🔍 找到匹配「{name}」的用户：\n", f"• **{_pu.display_name}**"]
                if _uid:
                    result_lines.append(f"  user_id: `{_uid}`")
                if _oid:
                    result_lines.append(f"  open_id: `{_oid}`")
                _email = getattr(_pu, "email", None)
                if _email:
                    result_lines.append(f"  邮箱: {_email}")
                return "\n".join(result_lines)
    except Exception as e:
        logger.debug("Suppressed: %s", e)

    total = len(_cached_users)
    if total == 0:
        return (
            f"❌ 本地通讯录缓存为空，暂时无法搜索「{name}」。\n\n"
            "通讯录缓存会在同事向机器人发消息时自动建立。\n"
            "如果「覃睿」从未给机器人发过消息，可以请他先给机器人发一条消息，"
            "之后就能直接搜索到他了。\n\n"
            "或者，请直接告诉我「覃睿」的飞书 open_id 或邮箱，我可以立刻操作。"
        )
    return (
        f"❌ 未在本地通讯录（已缓存 {total} 人）中找到「{name}」。\n\n"
        "通讯录缓存来自给机器人发过消息的同事。\n"
        "如果「{name}」从未给机器人发消息，请他先发一条，之后即可自动识别。\n"
        "或者请直接提供其飞书 open_id / 工作邮箱。"
    )


async def _feishu_contacts_refresh(agent_id: uuid.UUID) -> None:
    """Force-clear the local contacts cache so next search re-fetches from API."""
    import pathlib as _pl
    _cache_file = _pl.Path("/data/workspaces") / str(agent_id) / "feishu_contacts_cache.json"
    try:
        if _cache_file.exists():
            _cache_file.unlink()
    except Exception as e:
        logger.debug("Suppressed: %s", e)
