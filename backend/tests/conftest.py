import os
import sys

os.environ["MONGO_URI"] = "mongodb://127.0.0.1:27017/"
os.environ["MONGO_DB_NAME"] = "MediBotDB_test"
os.environ.setdefault("FLASK_SECRET_KEY", "test-secret-key")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from services.db import get_client, get_database


@pytest.fixture()
def app():
    from app import create_app

    flask_app = create_app()
    flask_app.config.update(TESTING=True)
    yield flask_app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _clean_test_database():
    yield
    client = get_client()
    client.drop_database(os.environ["MONGO_DB_NAME"])
