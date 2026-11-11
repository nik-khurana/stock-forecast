"""
Root main.py entrypoint for Uvicorn & Cloud Platforms (Railway, Render, Hugging Face).
Safely extracts and validates $PORT and $HOST to prevent CLI flag parsing crashes.
"""
import os
import uvicorn
from backend.app.config import HOST, PORT
from backend.app.main import app

if __name__ == "__main__":
    print(f"[StockCast] Booting Uvicorn production server on {HOST}:{PORT}")
    uvicorn.run("backend.app.main:app", host=HOST, port=PORT)
