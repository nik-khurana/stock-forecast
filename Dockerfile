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

# Copy application code
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
COPY your_application/ /app/your_application/
COPY wsgi.py /app/wsgi.py
COPY Procfile /app/Procfile
COPY README.md /app/README.md

# Ensure non-root appuser permissions (required for Hugging Face Spaces & security best practices)
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose ports (7860 for Hugging Face, 8000 default, overridden by Railway/Render $PORT)
EXPOSE 7860 8000 8080

# Start Uvicorn server dynamically binding to platform $PORT (defaults to 7860 for HF, $PORT for Railway)
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
