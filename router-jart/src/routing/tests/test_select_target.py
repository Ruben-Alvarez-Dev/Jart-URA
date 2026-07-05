"""Unit tests for the pure model-selection policy. No mocks, no I/O — real
domain logic exercised over real data structures."""
from __future__ import annotations

from src.routing.core.models import ModelInfo
from src.routing.core.service import select_target


def _model(name: str, status: str = "running", mtype: str = "chat", port: int = 9001) -> ModelInfo:
    return ModelInfo(name=name, port=port, type=mtype, status=status)


def test_explicit_model_running_is_selected():
    models = [_model("primary"), _model("small", port=9002)]
    res = select_target(models, "small")
    assert res.ok
    assert res.target.name == "small"
    assert res.target.chat_completions_url == "http://localhost:9002/v1/chat/completions"


def test_explicit_model_not_found_returns_404():
    res = select_target([_model("primary")], "ghost")
    assert not res.ok
    assert res.http_status == 404


def test_explicit_model_not_running_returns_503():
    res = select_target([_model("primary", status="stopped")], "primary")
    assert not res.ok
    assert res.http_status == 503


def test_no_model_falls_back_to_first_running_chat():
    models = [_model("primary", status="stopped"), _model("small", port=9002)]
    res = select_target(models, None)
    assert res.ok
    assert res.target.name == "small"


def test_no_running_chat_returns_503():
    models = [_model("primary", status="stopped")]
    res = select_target(models, None)
    assert not res.ok
    assert res.http_status == 503


def test_embedding_models_are_never_selected_for_chat():
    models = [_model("embed", mtype="embedding", port=9003)]
    res = select_target(models, None)
    assert not res.ok
    assert res.http_status == 503
