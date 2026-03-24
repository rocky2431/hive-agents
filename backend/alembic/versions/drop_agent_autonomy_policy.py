"""Merge current heads and drop the dead autonomy_policy column.

Revision ID: drop_agent_autonomy_policy
Revises: add_security_audit_and_rbac, df3da9cf3b27
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "drop_agent_autonomy_policy"
down_revision: Union[str, Sequence[str], None] = ("add_security_audit_and_rbac", "df3da9cf3b27")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE agents DROP COLUMN IF EXISTS autonomy_policy")


def downgrade() -> None:
    op.execute(
        "ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy_policy JSONB NOT NULL DEFAULT '{}'::jsonb"
    )
