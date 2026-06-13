"""user status + note (self-registration approval, M17)

Revision ID: e6a4c12d9f37
Revises: d5f1b830a7c4
Create Date: 2026-06-13 09:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e6a4c12d9f37'
down_revision: Union[str, Sequence[str], None] = 'd5f1b830a7c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('status', sa.String(length=16), nullable=False, server_default='active')
        )
        batch_op.add_column(sa.Column('note', sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('note')
        batch_op.drop_column('status')
