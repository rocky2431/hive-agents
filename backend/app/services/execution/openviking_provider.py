"""OpenViking-backed context provider — replaces FileContextProvider for enterprise deployments.

Uses OpenViking's L0/L1/L2 tiered context model with hierarchical retrieval
and tenant-scoped knowledge base access.
"""

from __future__ import annotations

import logging

from app.services import viking_client
from app.services.execution.context_middleware import FileContextProvider, _CHARS_PER_TOKEN

logger = logging.getLogger(__name__)


class OpenVikingContextProvider:
    """Context provider backed by OpenViking for semantic knowledge access.

    Falls back to FileContextProvider for agent-local files (soul, skills)
    that haven't been migrated to OpenViking yet.
    """

    def __init__(self, agent_data_dir: str, tenant_id: str) -> None:
        self.tenant_id = tenant_id
        self._file_provider = FileContextProvider(agent_data_dir)

    async def load_l0(self, agent_id: str, **kwargs) -> str:
        """Identity block — same as file provider (local, fast)."""
        return await self._file_provider.load_l0(agent_id, **kwargs)

    async def load_l1(self, agent_id: str, budget_tokens: int = 2000, **kwargs) -> str:
        """Essential context — soul from files + skills index from files.

        L1 stays file-based because soul.md and skills/ are agent-local
        and change frequently during a session.
        """
        return await self._file_provider.load_l1(agent_id, budget_tokens=budget_tokens, **kwargs)

    async def load_l2(self, agent_id: str, query: str | None = None, budget_tokens: int = 4000, **kwargs) -> str:
        """On-demand context — memory from files + org knowledge from OpenViking.

        This is where OpenViking adds value: semantic search across the
        organization's knowledge base, returning only relevant content
        within the token budget.
        """
        budget_chars = budget_tokens * _CHARS_PER_TOKEN
        parts: list[str] = []
        remaining = budget_chars

        # Agent memory (still file-based for now)
        file_l2 = await self._file_provider.load_l2(agent_id, query=query, budget_tokens=budget_tokens // 2)
        if file_l2:
            parts.append(file_l2)
            remaining -= len(file_l2)

        # Organization knowledge from OpenViking (semantic search)
        if query and remaining > 200 and viking_client.is_configured():
            results = await viking_client.find(
                query=query,
                target_uri="viking://resources/",
                tenant_id=self.tenant_id,
                agent_id=agent_id,
                limit=5,
            )
            if results:
                kb_parts = ["## Organization Knowledge"]
                for item in results:
                    title = item.get("title", item.get("uri", ""))
                    abstract = item.get("abstract", item.get("content", ""))[:300]
                    entry = f"- **{title}**: {abstract}"
                    if len("\n".join(kb_parts)) + len(entry) > remaining:
                        break
                    kb_parts.append(entry)
                if len(kb_parts) > 1:
                    parts.append("\n".join(kb_parts))

        return "\n\n".join(parts)


def get_context_provider(agent_data_dir: str, tenant_id: str | None = None):
    """Factory: return OpenVikingContextProvider if configured, else FileContextProvider."""
    if tenant_id and viking_client.is_configured():
        return OpenVikingContextProvider(agent_data_dir, tenant_id)
    return FileContextProvider(agent_data_dir)
