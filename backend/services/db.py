import os
from functools import lru_cache

from pymongo import MongoClient


DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017/"
DEFAULT_DB_NAME = "MediBotDB"


def _mongo_uri() -> str:
    return os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or DEFAULT_MONGO_URI


def _database_name() -> str:
    return os.getenv("MONGO_DB_NAME", DEFAULT_DB_NAME)


@lru_cache(maxsize=1)
def get_client() -> MongoClient:
    return MongoClient(_mongo_uri(), serverSelectionTimeoutMS=5000)


def get_database():
    return get_client()[_database_name()]
