"""
Root WSGI entrypoint for Gunicorn compatibility.
"""
from a2wsgi import ASGIMiddleware
from backend.app.main import app

application = ASGIMiddleware(app)
app_wsgi = application

