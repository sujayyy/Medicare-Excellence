import os
from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS

from models import ensure_indexes
from routes import register_blueprints


def load_local_env() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"").strip("'")

        if key and key not in os.environ:
            os.environ[key] = value


load_local_env()


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "medicare-excellence-dev-secret")
    app.config["JSON_SORT_KEYS"] = False
    app.config["UPLOADS_DIR"] = os.getenv("UPLOADS_DIR", os.path.join(app.root_path, "uploads", "documents"))

    CORS(
        app,
        resources={r"/*": {"origins": "*"}},
        allow_headers=["Content-Type", "Authorization"],
    )

    register_blueprints(app)

    try:
        ensure_indexes()
    except Exception as exc:  # pragma: no cover - startup warning path
        app.logger.warning("Database index initialization skipped: %s", exc)

    @app.get("/")
    def home():
        return jsonify(
            {
                "name": "Medicare Excellence API",
                "status": "ok",
                "message": "Medicare Excellence AI backend is running.",
            }
        )

    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5001")),
        debug=os.getenv("FLASK_DEBUG", "true").lower() == "true",
    )
