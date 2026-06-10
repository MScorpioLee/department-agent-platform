import pytest
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path}/test.db",
        enrollment_token="test-enroll",
        api_key="test-key",
    )
    app = create_app(settings)
    with TestClient(app) as c:
        yield c
