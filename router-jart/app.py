"""Router-Jart — FastAPI app: memory enrichment middleware + model-routing passthrough."""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.enrichment.core.models import EnrichmentConfig
from src.enrichment.factory import build_enrichment_service
from src.enrichment.middleware import EnrichmentMiddleware
from src.routing.core.models import RoutingConfig
from src.routing.factory import build_routing_components
from src.routing.router import router as routing_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jart.router")

# Build enrichment service from env vars
config = EnrichmentConfig.from_env()
service = build_enrichment_service(config)
routing_config = RoutingConfig.from_env()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Own the shared HTTP client and the routing components for the app's lifetime."""
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(
            routing_config.read_timeout_s, connect=routing_config.connect_timeout_s
        )
    )
    routing_service, chat_forwarder = build_routing_components(routing_config, http_client)
    app.state.http_client = http_client
    app.state.routing_service = routing_service
    app.state.chat_forwarder = chat_forwarder
    try:
        yield
    finally:
        await http_client.aclose()


app = FastAPI(title="Router-Jart", version="0.1.0", lifespan=lifespan)

# Enrich POST /v1/chat/completions before it reaches the passthrough route (never blocks).
app.add_middleware(EnrichmentMiddleware, service=service, config=config)

# Mount the model-routing passthrough: POST /v1/chat/completions -> selected model.
app.include_router(routing_router)


@app.get("/health")
async def health():
    memory_ok = await service._retriever.health()
    return {
        "status": "ok",
        "enrichment": {
            "enabled": config.enabled,
            "memory_service": "reachable" if memory_ok else "unreachable",
            "memory_url": config.memory_url,
        },
    }


@app.post("/api/enrich")
async def enrich_endpoint(request: Request):
    """Standalone enrichment endpoint for IDE hooks."""
    body = await request.json()
    messages = body.get("messages", [])
    agent_id = body.get("agent_id", "shared")
    token_budget = body.get("token_budget", config.token_budget)

    t0 = time.perf_counter()
    enriched_messages, result = await service.enrich(messages)
    latency_ms = (time.perf_counter() - t0) * 1000

    return JSONResponse({
        "messages": enriched_messages,
        "injection_text": result.injection_text if result.has_context else "",
        "facts_count": len(result.facts),
        "was_enriched": result.has_context,
        "latency_ms": round(latency_ms, 1),
        "degraded": latency_ms > config.timeout_ms,
    })


@app.get("/api/enrich/health")
async def enrich_health():
    """Enrichment subsystem health."""
    memory_ok = await service._retriever.health()
    return {
        "middleware_status": "active" if config.enabled else "disabled",
        "memory_service": "reachable" if memory_ok else "unreachable",
        "memory_service_url": config.memory_url,
    }


@app.get("/api/enrich/config")
async def enrich_config():
    """Active enrichment configuration."""
    return {
        "enabled": config.enabled,
        "memory_url": config.memory_url,
        "token_budget": config.token_budget,
        "min_score": config.min_score,
        "timeout_ms": config.timeout_ms,
        "cache_ttl_s": config.cache_ttl_s,
        "skip_agent_ids": config.skip_agent_ids,
        "injection_style": config.injection_style,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10200)
