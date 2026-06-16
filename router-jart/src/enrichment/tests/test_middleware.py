"""Tests for EnrichmentMiddleware."""
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fastapi import Body

from ..adapters.memory.null import NullMemoryAdapter
from ..core.models import EnrichmentConfig
from ..core.service import EnrichmentService
from ..adapters.extraction.message import MessageContextExtractor
from ..middleware import EnrichmentMiddleware


def _make_app(config=None):
    cfg = config or EnrichmentConfig(enabled=True, min_score=0.65)
    retriever = NullMemoryAdapter()
    extractor = MessageContextExtractor()
    service = EnrichmentService(retriever=retriever, extractor=extractor, config=cfg)

    app = FastAPI()
    app.add_middleware(EnrichmentMiddleware, service=service, config=cfg)

    @app.post("/v1/chat/completions")
    async def chat(body: dict = Body(...)):
        return {"messages": body.get("messages", []), "model": "test"}

    @app.get("/v1/models")
    async def models():
        return {"data": [{"id": "test-model"}]}

    @app.post("/v1/embeddings")
    async def embeddings(body: dict = Body(...)):
        return {"data": []}

    return app


def test_chat_completions_intercepted():
    app = _make_app()
    client = TestClient(app)
    resp = client.post("/v1/chat/completions", json={
        "messages": [{"role": "user", "content": "What is the router config?"}],
    })
    assert resp.status_code == 200


def test_embeddings_passthrough():
    app = _make_app()
    client = TestClient(app)
    resp = client.post("/v1/embeddings", json={"input": "test", "model": "bge"})
    assert resp.status_code == 200
    assert resp.json() == {"data": []}


def test_models_passthrough():
    app = _make_app()
    client = TestClient(app)
    resp = client.get("/v1/models")
    assert resp.status_code == 200
    assert resp.json()["data"][0]["id"] == "test-model"


def test_disabled_config_passthrough():
    app = _make_app(config=EnrichmentConfig(enabled=False))
    client = TestClient(app)
    resp = client.post("/v1/chat/completions", json={
        "messages": [{"role": "user", "content": "What is the router config?"}],
    })
    assert resp.status_code == 200
