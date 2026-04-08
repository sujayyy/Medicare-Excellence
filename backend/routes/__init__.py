from flask import Flask

from routes.admin import admin_blueprint
from routes.auth import auth_blueprint
from routes.chat import chat_blueprint
from routes.documents import documents_blueprint
from routes.vitals import vitals_blueprint


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(auth_blueprint)
    app.register_blueprint(chat_blueprint)
    app.register_blueprint(admin_blueprint)
    app.register_blueprint(documents_blueprint)
    app.register_blueprint(vitals_blueprint)
