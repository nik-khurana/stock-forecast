# Production Dockerfile for StockCast ML Backend & Fullstack Deployment
# Compatible with: Hugging Face Spaces (100% Free Docker tier) & Render.com

FROM python:3.11-slim

# Set environment variables for Python optimization
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

# Install minimal OS dependencies if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend and frontend source code
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
COPY README.md /app/README.md

# Hugging Face Spaces runs as user 1000 by default
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose default port (7860 for Hugging Face, overridden by Render's $PORT)
EXPOSE 7860

# Start Uvicorn server
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT}"]
