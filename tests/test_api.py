import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture(autouse=True)
def no_sarvam_env(monkeypatch):
    for var in ("SARVAM_API_KEY", "SARVAM_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr("services.analyzer.get_sarvam_api_key", lambda override=None: override or "")


client = TestClient(main.app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "active"}


def test_analyze_returns_canonical_report():
    r = client.post("/analyze", json={"text": "Studies show 90% of people agree. The sky is blue."})
    assert r.status_code == 200
    body = r.json()
    assert body["metrics"]["total_claims"] == 2
    assert body["engine"]["name"] == "Heuristic Engine"
    assert body["metrics"]["statistics"]["unverified_count"] == 1


def test_analyze_rejects_oversized_input():
    r = client.post("/analyze", json={"text": "a" * (main.MAX_TEXT_LENGTH + 1)})
    assert r.status_code == 422


def test_analyze_internal_error_is_500_not_fake_result(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("bug")

    monkeypatch.setattr(main, "analyze_text", boom)
    r = client.post("/analyze", json={"text": "hello"})
    assert r.status_code == 500


def test_unknown_api_route_is_404():
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404


def test_cors_does_not_allow_credentials_with_wildcard():
    r = client.options(
        "/analyze",
        headers={"Origin": "https://example.com", "Access-Control-Request-Method": "POST"},
    )
    assert r.headers.get("access-control-allow-credentials") != "true"
