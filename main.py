"""
Root main.py entrypoint for Uvicorn convenience.
Delegates to backend.app.main:app.
"""
from backend.app.main import app

if __name__ == "__main__":
    import uvicorn
    from backend.app.config import HOST, PORT
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
