"""user api keys (M13 relay)

Revision ID: b3d8f12c4e90
Revises: a7c2e91d5b04
Create Date: 2026-06-12 16:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3d8f12c4e90'
down_revision: Union[str, Sequence[str], None] = 'a7c2e91d5b04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'user_api_keys',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('user_id', sa.String(length=64), nullable=False, index=True),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.Column('key_hash', sa.String(length=128), nullable=False, unique=True, index=True),
        sa.Column('prefix', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('user_api_keys')
