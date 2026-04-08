import os

from flask import Flask, jsonify
from flask_cors import CORS

from models import ensure_indexes
from routes import register_blueprints


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "medicare-excellence-dev-secret")
    app.config["JSON_SORT_KEYS"] = False

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
