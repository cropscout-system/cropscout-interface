FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

COPY . .

RUN uv pip install -r requirements.lock

EXPOSE 8000
CMD python3 cropscout/main.py