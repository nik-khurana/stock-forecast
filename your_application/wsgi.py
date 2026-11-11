"""
WSGI adapter entrypoint for compatibility with Gunicorn.
Adapts FastAPI (ASGI) to WSGI using a2wsgi so that commands like:
    gunicorn your_application.wsgi
run cleanly without crashing on Render or other PaaS platforms.
"""
from a2wsgi import ASGIMiddleware
from backend.app.main import app

application = ASGIMiddleware(app)
