"""model backend oauth columns (M14)

Revision ID: c4e7a91f08b2
Revises: b3d8f12c4e90
Create Date: 2026-06-12 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e7a91f08b2'
down_revision: Union[str, Sequence[str], None] = 'b3d8f12c4e90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('model_backends', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('auth_type', sa.String(length=16), nullable=False, server_default='api_key')
        )
        batch_op.add_column(sa.Column('oauth_enc', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('model_backends', schema=None) as batch_op:
        batch_op.drop_column('oauth_enc')
        batch_op.drop_column('auth_type')
