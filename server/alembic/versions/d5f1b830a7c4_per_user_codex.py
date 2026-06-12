"""per-user model credentials + codex runtime (M15)

Revision ID: d5f1b830a7c4
Revises: c4e7a91f08b2
Create Date: 2026-06-12 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5f1b830a7c4'
down_revision: Union[str, Sequence[str], None] = 'c4e7a91f08b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('model_backends', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('auth_scope', sa.String(length=16), nullable=False, server_default='shared')
        )
        batch_op.add_column(
            sa.Column('runtime', sa.String(length=24), nullable=False, server_default='openai_chat')
        )
    op.create_table(
        'user_model_credentials',
        sa.Column('user_id', sa.String(length=64), primary_key=True),
        sa.Column('backend_id', sa.String(length=64), primary_key=True),
        sa.Column('oauth_enc', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('user_model_credentials')
    with op.batch_alter_table('model_backends', schema=None) as batch_op:
        batch_op.drop_column('runtime')
        batch_op.drop_column('auth_scope')
