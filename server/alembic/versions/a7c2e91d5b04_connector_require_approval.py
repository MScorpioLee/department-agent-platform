"""connector require_approval column

Revision ID: a7c2e91d5b04
Revises: f44fb3430e45
Create Date: 2026-06-12 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c2e91d5b04'
down_revision: Union[str, Sequence[str], None] = 'f44fb3430e45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('connectors', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('require_approval', sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('connectors', schema=None) as batch_op:
        batch_op.drop_column('require_approval')
