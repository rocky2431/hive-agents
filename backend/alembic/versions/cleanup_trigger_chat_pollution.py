"""One-time cleanup: remove trigger notifications that leaked into user chat sessions.

Previous trigger_daemon.py duplicated trigger results into user conversations.
This migration deletes those messages. Trigger results remain in Reflection Sessions.

Revision ID: cleanup_trigger_chat
Revises: update_tenant_tz_0331
"""
from alembic import op
import sqlalchemy as sa

revision = "cleanup_trigger_chat"
down_revision = "update_tenant_tz_0331"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Delete trigger notification messages from non-trigger sessions
    result = conn.execute(sa.text("""
        DELETE FROM chat_messages
        WHERE content LIKE '⚡ **触发器触发**%'
          AND conversation_id NOT IN (
              SELECT CAST(id AS TEXT) FROM chat_sessions WHERE source_channel = 'trigger'
          )
    """))
    if result.rowcount:
        print(f"[migration] Cleaned up {result.rowcount} trigger notification(s) from user chat sessions")


def downgrade() -> None:
    # Data cleanup is not reversible — the messages were duplicates anyway
    pass
