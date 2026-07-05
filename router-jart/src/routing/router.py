"""FastAPI router exposing the chat-completions passthrough."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

router = APIRouter()


@router.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """Resolve the target model from the Control Plane registry and stream the
    upstream response.

    The request body has already been enriched (when applicable) by the
    EnrichmentMiddleware, which runs ahead of this handler.
    """
    body = await request.json()

    routing_service = request.app.state.routing_service
    chat_forwarder = request.app.state.chat_forwarder

    resolution = await routing_service.resolve(body)
    if not resolution.ok:
        return JSONResponse(
            status_code=resolution.http_status,
            content={"error": {"message": resolution.error, "type": "routing_error"}},
        )

    upstream = await chat_forwarder.forward(resolution.target, body, dict(request.headers))
    return StreamingResponse(
        upstream.body,
        status_code=upstream.status_code,
        media_type=upstream.media_type,
        background=BackgroundTask(upstream.aclose),
    )
