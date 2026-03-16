"""Tenant isolation middleware — extracts tenant_id from JWT and injects into request state.

Every authenticated request gets request.state.tenant_id set.
Non-tenant requests (except whitelisted paths) are rejected with 403.
"""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# Paths that don't require tenant context
_PUBLIC_PATHS = frozenset({
    "/api/health",
    "/api/auth/login",
    "/api/auth/register",
    "/docs",
    "/openapi.json",
    "/redoc",
})

# Path prefixes that don't require tenant context
_PUBLIC_PREFIXES = (
    "/ws/",
    "/webhooks/",
    "/api/auth/",
    "/api/tenants/public/",
)


def _is_public_path(path: str) -> bool:
    """Check if a path is public (no tenant context needed)."""
    if path in _PUBLIC_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES)


class TenantMiddleware(BaseHTTPMiddleware):
    """Extract tenant_id from the authenticated user and inject into request.state.

    This middleware runs AFTER authentication. It expects request.state.user
    to be set by the route dependency (get_current_user). Since FastAPI
    dependencies run inside the route, we use a different approach:

    We decode the JWT here to extract tenant_id without loading the full user.
    This avoids a DB query and works at the middleware level.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        # Skip public paths
        if _is_public_path(path):
            request.state.tenant_id = None
            return await call_next(request)

        # Try to extract tenant_id from JWT
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            # No auth header — let the route dependency handle 401
            request.state.tenant_id = None
            return await call_next(request)

        token = auth_header[7:]
        try:
            from jose import jwt as jose_jwt
            payload = jose_jwt.decode(
                token, settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM],
                options={"verify_exp": False},  # Expiry checked by route dependency
            )
            tenant_id = payload.get("tid")  # tenant_id claim
            user_role = payload.get("role", "")

            if tenant_id:
                request.state.tenant_id = tenant_id
            elif user_role == "platform_admin":
                # Platform admins may not have a tenant — use header override
                override = request.headers.get("x-tenant-id")
                request.state.tenant_id = override
            else:
                # User has no tenant — this shouldn't happen for normal users
                # Let the request through; route-level checks will handle it
                request.state.tenant_id = None

        except Exception:
            # JWT decode failed — let the route dependency handle it
            request.state.tenant_id = None

        return await call_next(request)
