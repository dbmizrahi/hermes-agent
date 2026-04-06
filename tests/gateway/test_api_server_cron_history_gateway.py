"""
Tests for the Cron History + Gateway & Platforms API endpoints.

Cron History:
- GET /api/jobs/output (list recent outputs across all jobs)
- GET /api/jobs/{job_id}/history (list run history for specific job)
- GET /api/jobs/{job_id}/output/{run_id} (get output of specific run, 404 if missing)

Gateway & Platforms:
- GET /api/gateway/status (gateway health, uptime, active sessions)
- GET /api/gateway/platforms (list configured platforms with status)
- POST /api/gateway/platforms (add new platform + credentials)
- POST /api/gateway/platforms/{name}/connect (connect platform)
- POST /api/gateway/platforms/{name}/disconnect (disconnect platform)
- PATCH /api/gateway/platforms/{name} (update platform credentials)
- DELETE /api/gateway/platforms/{name} (remove platform, 404 if missing)
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gateway.config import Platform, PlatformConfig
from gateway.platforms.api_server import APIServerAdapter, cors_middleware


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_JOB_ID = "aabbccddeeff"
VALID_RUN_ID = "20250101_120000"


def _make_adapter(api_key: str = "") -> APIServerAdapter:
    """Create an adapter with optional API key."""
    extra = {}
    if api_key:
        extra["key"] = api_key
    config = PlatformConfig(enabled=True, extra=extra)
    return APIServerAdapter(config)


def _create_cron_app(
    adapter: APIServerAdapter,
    gateway_runner=None,
) -> web.Application:
    """Create app with cron history + gateway routes (no job CRUD or chat)."""
    app = web.Application(middlewares=[cors_middleware])
    app["api_server_adapter"] = adapter
    if gateway_runner is not None:
        app["gateway_runner"] = gateway_runner

    # Cron history routes
    app.router.add_get("/api/jobs/output", adapter._handle_all_outputs)
    app.router.add_get("/api/jobs/{job_id}/history", adapter._handle_job_history)
    app.router.add_get(
        "/api/jobs/{job_id}/output/{run_id}", adapter._handle_job_output
    )

    # Gateway & platform routes
    app.router.add_get("/api/gateway/status", adapter._handle_gateway_status)
    app.router.add_get("/api/gateway/platforms", adapter._handle_list_platforms)
    app.router.add_post("/api/gateway/platforms", adapter._handle_add_platform)
    app.router.add_post(
        "/api/gateway/platforms/{name}/connect", adapter._handle_connect_platform
    )
    app.router.add_post(
        "/api/gateway/platforms/{name}/disconnect",
        adapter._handle_disconnect_platform,
    )
    app.router.add_patch(
        "/api/gateway/platforms/{name}", adapter._handle_update_platform
    )
    app.router.add_delete(
        "/api/gateway/platforms/{name}", adapter._handle_remove_platform
    )
    return app


@pytest.fixture
def adapter():
    return _make_adapter()


@pytest.fixture
def auth_adapter():
    return _make_adapter(api_key="sk-secret-123")


# ---------------------------------------------------------------------------
# Mock GatewayRunner
# ---------------------------------------------------------------------------

def _mock_gateway_runner(adapters: dict | None = None) -> MagicMock:
    """Create a mock GatewayRunner with given adapters dict."""
    runner = MagicMock()
    runner.adapters = adapters or {}
    return runner


# ---------------------------------------------------------------------------
# Cron History: GET /api/jobs/output
# ---------------------------------------------------------------------------

class TestAllOutputs:
    @pytest.mark.asyncio
    async def test_list_outputs_empty(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/output returns empty list when no outputs exist."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(APIServerAdapter, "_CRON_AVAILABLE", True), \
                 patch.object(APIServerAdapter, "_cron_list", return_value=[]):
                resp = await cli.get("/api/jobs/output")
                assert resp.status == 200
                data = await resp.json()
                assert data["runs"] == []
                assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_list_outputs_with_files(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/output returns run files found on disk."""
        hermes_home = tmp_path / ".hermes"
        output_dir = hermes_home / "cron" / "output" / VALID_JOB_ID
        output_dir.mkdir(parents=True)
        (output_dir / f"{VALID_RUN_ID}.md").write_text("# Test Output")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(APIServerAdapter, "_CRON_AVAILABLE", True), \
                 patch.object(
                     APIServerAdapter,
                     "_cron_list",
                     return_value=[{"id": VALID_JOB_ID, "name": "test-job"}],
                 ):
                resp = await cli.get("/api/jobs/output")
                assert resp.status == 200
                data = await resp.json()
                assert data["total"] == 1
                assert len(data["runs"]) == 1
                assert data["runs"][0]["job_id"] == VALID_JOB_ID
                assert data["runs"][0]["job_name"] == "test-job"

    @pytest.mark.asyncio
    async def test_list_outputs_respects_limit(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/output limit=1 returns only one result."""
        hermes_home = tmp_path / ".hermes"
        output_dir = hermes_home / "cron" / "output" / VALID_JOB_ID
        output_dir.mkdir(parents=True)
        (output_dir / "20250101_090000.md").write_text("# first")
        (output_dir / "20250101_100000.md").write_text("# second")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(APIServerAdapter, "_CRON_AVAILABLE", True), \
                 patch.object(APIServerAdapter, "_cron_list", return_value=[]):
                resp = await cli.get("/api/jobs/output?limit=1")
                assert resp.status == 200
                data = await resp.json()
                assert len(data["runs"]) == 1
                assert data["total"] == 2
                assert data["limit"] == 1

    @pytest.mark.asyncio
    async def test_list_outputs_job_id_filter(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/output?job_id=X only returns that job's outputs."""
        hermes_home = tmp_path / ".hermes"
        for jid in ("aabb00112233", "aabb00445566"):
            d = hermes_home / "cron" / "output" / jid
            d.mkdir(parents=True)
            (d / "20250101_120000.md").write_text(f"# {jid}")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(APIServerAdapter, "_CRON_AVAILABLE", True), \
                 patch.object(APIServerAdapter, "_cron_list", return_value=[]):
                resp = await cli.get("/api/jobs/output?job_id=aabb00112233")
                assert resp.status == 200
                data = await resp.json()
                assert len(data["runs"]) == 1
                assert data["runs"][0]["job_id"] == "aabb00112233"

    @pytest.mark.asyncio
    async def test_list_outputs_requires_auth(self, auth_adapter, tmp_path, monkeypatch):
        """GET /api/jobs/output returns 401 without API key."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/jobs/output")
            assert resp.status == 401


# ---------------------------------------------------------------------------
# Cron History: GET /api/jobs/{job_id}/history
# ---------------------------------------------------------------------------

class TestJobHistory:
    @pytest.mark.asyncio
    async def test_job_history_no_outputs_job_exists(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/history with no output dir but job exists returns empty runs."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(APIServerAdapter, "_CRON_AVAILABLE", True), \
                 patch.object(
                     APIServerAdapter, "_cron_get",
                     return_value={"id": VALID_JOB_ID, "name": "my-job"},
                 ):
                resp = await cli.get(f"/api/jobs/{VALID_JOB_ID}/history")
                assert resp.status == 200
                data = await resp.json()
                assert data["job_id"] == VALID_JOB_ID
                assert data["job_name"] == "my-job"
                assert data["runs"] == []
                assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_job_history_no_outputs_job_unknown(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/history returns 404 when job doesn't exist and no output dir."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(APIServerAdapter, "_CRON_AVAILABLE", True), \
                 patch.object(APIServerAdapter, "_cron_get", return_value=None):
                resp = await cli.get(f"/api/jobs/{VALID_JOB_ID}/history")
                assert resp.status == 404

    @pytest.mark.asyncio
    async def test_job_history_with_outputs(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/history returns run metadata for output files."""
        hermes_home = tmp_path / ".hermes"
        output_dir = hermes_home / "cron" / "output" / VALID_JOB_ID
        output_dir.mkdir(parents=True)
        (output_dir / f"{VALID_RUN_ID}.md").write_text("# output content")
        (output_dir / "20250102_080000.md").write_text("# older output")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(APIServerAdapter, "_CRON_AVAILABLE", True), \
                 patch.object(
                     APIServerAdapter, "_cron_get",
                     return_value={"id": VALID_JOB_ID, "name": "my-job"},
                 ):
                resp = await cli.get(f"/api/jobs/{VALID_JOB_ID}/history")
                assert resp.status == 200
                data = await resp.json()
                assert data["job_id"] == VALID_JOB_ID
                assert data["total"] == 2
                assert len(data["runs"]) == 2
                # Most recent first (sorted reverse by stem)
                assert data["runs"][0]["run_id"] == "20250102_080000"

    @pytest.mark.asyncio
    async def test_job_history_pagination(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/history respects limit and offset."""
        hermes_home = tmp_path / ".hermes"
        output_dir = hermes_home / "cron" / "output" / VALID_JOB_ID
        output_dir.mkdir(parents=True)
        for i in range(5):
            (output_dir / f"20250101_{i:06d}.md").write_text(f"# run {i}")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(APIServerAdapter, "_CRON_AVAILABLE", True), \
                 patch.object(APIServerAdapter, "_cron_get", return_value={}):
                resp = await cli.get(
                    f"/api/jobs/{VALID_JOB_ID}/history?limit=2&offset=1"
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["total"] == 5
                assert len(data["runs"]) == 2
                assert data["limit"] == 2
                assert data["offset"] == 1

    @pytest.mark.asyncio
    async def test_job_history_invalid_job_id(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/history with malformed id returns 400."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/jobs/not-hex-id/history")
            assert resp.status == 400

    @pytest.mark.asyncio
    async def test_job_history_requires_auth(self, auth_adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/history returns 401 without API key."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(f"/api/jobs/{VALID_JOB_ID}/history")
            assert resp.status == 401


# ---------------------------------------------------------------------------
# Cron History: GET /api/jobs/{job_id}/output/{run_id}
# ---------------------------------------------------------------------------

class TestJobOutput:
    @pytest.mark.asyncio
    async def test_job_output_returns_content(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/output/{run_id} returns markdown content."""
        hermes_home = tmp_path / ".hermes"
        output_dir = hermes_home / "cron" / "output" / VALID_JOB_ID
        output_dir.mkdir(parents=True)
        content = "# Job Output\n\nStep 1: done\n"
        (output_dir / f"{VALID_RUN_ID}.md").write_text(content)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                f"/api/jobs/{VALID_JOB_ID}/output/{VALID_RUN_ID}"
            )
            assert resp.status == 200
            text = await resp.text()
            assert text == content
            assert "markdown" in resp.headers.get("Content-Type", "")

    @pytest.mark.asyncio
    async def test_job_output_not_found(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/output/{run_id} returns 404 for missing run."""
        hermes_home = tmp_path / ".hermes"
        output_dir = hermes_home / "cron" / "output" / VALID_JOB_ID
        output_dir.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                f"/api/jobs/{VALID_JOB_ID}/output/99999999_999999"
            )
            assert resp.status == 404

    @pytest.mark.asyncio
    async def test_job_output_invalid_job_id(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/output/{run_id} returns 400 for bad job_id."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/jobs/bad-id/output/20250101_120000")
            assert resp.status == 400
            data = await resp.json()
            assert "Invalid" in data["error"]

    @pytest.mark.asyncio
    async def test_job_output_invalid_run_id(self, adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/output/{run_id} returns 400 for bad run_id."""
        hermes_home = tmp_path / ".hermes"
        output_dir = hermes_home / "cron" / "output" / VALID_JOB_ID
        output_dir.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                f"/api/jobs/{VALID_JOB_ID}/output/not-a-valid-run-id"
            )
            assert resp.status == 400
            data = await resp.json()
            assert "Invalid" in data["error"]

    @pytest.mark.asyncio
    async def test_job_output_requires_auth(self, auth_adapter, tmp_path, monkeypatch):
        """GET /api/jobs/{id}/output/{run_id} returns 401 without key."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                f"/api/jobs/{VALID_JOB_ID}/output/{VALID_RUN_ID}"
            )
            assert resp.status == 401


# ---------------------------------------------------------------------------
# Gateway: GET /api/gateway/status
# ---------------------------------------------------------------------------

class TestGatewayStatus:
    @pytest.mark.asyncio
    async def test_gateway_status_no_runner(self, adapter):
        """GET /api/gateway/status returns status even without runner."""
        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/gateway/status")
            assert resp.status == 200
            data = await resp.json()
            assert data["status"] == "running"
            assert "uptime_seconds" in data
            assert data["platforms"] == []

    @pytest.mark.asyncio
    async def test_gateway_status_with_adapter(self, adapter):
        """GET /api/gateway/status lists connected platform adapters."""
        mock_adapter = MagicMock()
        mock_adapter.name = "telegram"
        mock_adapter.platform = Platform.TELEGRAM
        mock_adapter.is_connected = True
        mock_adapter._connected_since = 1000
        mock_adapter._last_error = None

        runner = _mock_gateway_runner({Platform.TELEGRAM: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/gateway/status")
            assert resp.status == 200
            data = await resp.json()
            assert data["status"] == "running"
            assert len(data["platforms"]) == 1
            plat = data["platforms"][0]
            assert plat["name"] == "telegram"
            assert plat["type"] == "telegram"
            assert plat["connected"] is True
            assert plat["connected_since"] == 1000

    @pytest.mark.asyncio
    async def test_gateway_status_disconnected_adapter(self, adapter):
        """Gateway status shows connected=False when adapter is down."""
        mock_adapter = MagicMock()
        mock_adapter.name = "discord"
        mock_adapter.platform = Platform.DISCORD
        mock_adapter.is_connected = False
        mock_adapter._connected_since = None
        mock_adapter._last_error = "Connection refused"

        runner = _mock_gateway_runner({Platform.DISCORD: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/gateway/status")
            assert resp.status == 200
            data = await resp.json()
            plat = data["platforms"][0]
            assert plat["name"] == "discord"
            assert plat["connected"] is False
            assert plat["error"] == "Connection refused"

    @pytest.mark.asyncio
    async def test_gateway_status_requires_auth(self, auth_adapter):
        """GET /api/gateway/status returns 401 without API key."""
        app = _create_cron_app(auth_adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/gateway/status")
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_gateway_status_returns_version(self, adapter):
        """GET /api/gateway/status includes version field."""
        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/gateway/status")
            assert resp.status == 200
            data = await resp.json()
            assert "version" in data


# ---------------------------------------------------------------------------
# Gateway: GET /api/gateway/platforms
# ---------------------------------------------------------------------------

class TestListPlatforms:
    @pytest.mark.asyncio
    async def test_list_platforms_empty_no_runner(self, adapter):
        """GET /api/gateway/platforms returns empty list when runner is not wired."""
        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/gateway/platforms")
            assert resp.status == 200
            data = await resp.json()
            assert data["platforms"] == []

    @pytest.mark.asyncio
    async def test_list_platforms_with_adapters(self, adapter):
        """GET /api/gateway/platforms lists all adapters with config."""
        mock_adapter = MagicMock()
        mock_adapter.name = "slack"
        mock_adapter.platform = Platform.SLACK
        mock_adapter.is_connected = True
        mock_adapter._config = PlatformConfig(
            enabled=True, extra={"token": "xoxb-123", "signing_secret": "abc"}
        )

        runner = _mock_gateway_runner({Platform.SLACK: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/gateway/platforms")
            assert resp.status == 200
            data = await resp.json()
            assert len(data["platforms"]) == 1
            plat = data["platforms"][0]
            assert plat["name"] == "slack"
            assert plat["type"] == "slack"
            assert plat["connected"] is True
            # Config should be redacted
            assert "token" in plat["config"]
            assert plat["config"]["token"] == "[REDACTED]"

    @pytest.mark.asyncio
    async def test_list_platforms_requires_auth(self, auth_adapter):
        """GET /api/gateway/platforms returns 401 without API key."""
        app = _create_cron_app(auth_adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/gateway/platforms")
            assert resp.status == 401


# ---------------------------------------------------------------------------
# Gateway: POST /api/gateway/platforms (add)
# ---------------------------------------------------------------------------

class TestAddPlatform:
    @pytest.mark.asyncio
    async def test_add_platform_valid(self, adapter, tmp_path, monkeypatch):
        """POST /api/gateway/platforms with valid JSON adds platform."""
        hermes_home = tmp_path / ".hermes"
        cfg_path = hermes_home / "config.yaml"
        cfg_path.parent.mkdir(parents=True)
        cfg_path.write_text("platforms: {}\n")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        mock_adapter = MagicMock()
        mock_adapter.name = "telegram"
        runner = _mock_gateway_runner({})
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:
            with patch("gateway.platforms.api_server._create_adapter") as mock_create:
                mock_create.return_value = None  # prevent actual connect attempt
                resp = await cli.post(
                    "/api/gateway/platforms",
                    json={
                        "name": "telegram",
                        "type": "telegram",
                        "config": {"token": "123:AABB"},
                        "connect": False,
                    },
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["name"] == "telegram"
                assert data["type"] == "telegram"
                assert data["connected"] is False

    @pytest.mark.asyncio
    async def test_add_platform_invalid_json(self, adapter, tmp_path, monkeypatch):
        """POST /api/gateway/platforms with bad JSON returns 400."""
        hermes_home = tmp_path / ".hermes"
        cfg_path = hermes_home / "config.yaml"
        cfg_path.parent.mkdir(parents=True)
        cfg_path.write_text("platforms: {}\n")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter, gateway_runner=MagicMock())
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/api/gateway/platforms",
                data="{{{not-json",
                headers={"Content-Type": "application/json"},
            )
            assert resp.status == 400

    @pytest.mark.asyncio
    async def test_add_platform_missing_fields(self, adapter, tmp_path, monkeypatch):
        """POST /api/gateway/platforms without name/type returns 400."""
        hermes_home = tmp_path / ".hermes"
        cfg_path = hermes_home / "config.yaml"
        cfg_path.parent.mkdir(parents=True)
        cfg_path.write_text("platforms: {}\n")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter, gateway_runner=MagicMock())
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/api/gateway/platforms",
                json={"config": {}},
            )
            assert resp.status == 400

    @pytest.mark.asyncio
    async def test_add_platform_duplicate_name(self, adapter, tmp_path, monkeypatch):
        """POST /api/gateway/platforms with existing name returns 409."""
        hermes_home = tmp_path / ".hermes"
        cfg_path = hermes_home / "config.yaml"
        cfg_path.parent.mkdir(parents=True)
        cfg_path.write_text("platforms: {}\n")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        mock_adapter = MagicMock()
        mock_adapter.name = "telegram"
        runner = _mock_gateway_runner({Platform.TELEGRAM: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/api/gateway/platforms",
                json={"name": "telegram", "type": "telegram"},
            )
            assert resp.status == 409

    @pytest.mark.asyncio
    async def test_add_platform_requires_auth(self, auth_adapter, tmp_path, monkeypatch):
        """POST /api/gateway/platforms returns 401 without API key."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir()
        (hermes_home / "config.yaml").write_text("platforms: {}\n")
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(auth_adapter, gateway_runner=MagicMock())
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/api/gateway/platforms",
                json={"name": "test", "type": "telegram"},
            )
            assert resp.status == 401


# ---------------------------------------------------------------------------
# Gateway: POST /api/gateway/platforms/{name}/connect
# ---------------------------------------------------------------------------

class TestConnectPlatform:
    @pytest.mark.asyncio
    async def test_connect_platform_success(self, adapter):
        """POST /api/gateway/platforms/{name}/connect returns 200."""
        mock_adapter = MagicMock()
        mock_adapter.name = "telegram"
        mock_adapter.is_connected = False
        mock_adapter.connect = AsyncMock(return_value=True)

        runner = _mock_gateway_runner({Platform.TELEGRAM: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/telegram/connect")
            assert resp.status == 200
            data = await resp.json()
            assert data["name"] == "telegram"
            assert data["connected"] is True
            mock_adapter.connect.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_connect_platform_no_runner(self, adapter):
        """POST /api/gateway/platforms/{name}/connect returns 503 without runner."""
        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/telegram/connect")
            assert resp.status == 503

    @pytest.mark.asyncio
    async def test_connect_platform_not_found(self, adapter):
        """POST /api/gateway/platforms/{name}/connect returns 404 for unknown name."""
        runner = _mock_gateway_runner({})
        app = _create_cron_app(adapter, gateway_runner=runner)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/ghost/connect")
            assert resp.status == 404

    @pytest.mark.asyncio
    async def test_connect_platform_already_connected(self, adapter):
        """POST /api/gateway/platforms/{name}/connect returns 409 if already on."""
        mock_adapter = MagicMock()
        mock_adapter.name = "telegram"
        mock_adapter.is_connected = True

        runner = _mock_gateway_runner({Platform.TELEGRAM: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/telegram/connect")
            assert resp.status == 409

    @pytest.mark.asyncio
    async def test_connect_platform_fails(self, adapter):
        """POST /api/gateway/platforms/{name}/connect returns 502 on failure."""
        mock_adapter = MagicMock()
        mock_adapter.name = "telegram"
        mock_adapter.is_connected = False
        mock_adapter.connect = AsyncMock(return_value=False)

        runner = _mock_gateway_runner({Platform.TELEGRAM: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/telegram/connect")
            assert resp.status == 502

    @pytest.mark.asyncio
    async def test_connect_platform_requires_auth(self, auth_adapter):
        """POST /api/gateway/platforms/{name}/connect returns 401."""
        app = _create_cron_app(auth_adapter, gateway_runner=MagicMock())
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/test/connect")
            assert resp.status == 401


# ---------------------------------------------------------------------------
# Gateway: POST /api/gateway/platforms/{name}/disconnect
# ---------------------------------------------------------------------------

class TestDisconnectPlatform:
    @pytest.mark.asyncio
    async def test_disconnect_platform_success(self, adapter):
        """POST /api/gateway/platforms/{name}/disconnect returns 200."""
        mock_adapter = MagicMock()
        mock_adapter.name = "telegram"
        mock_adapter.is_connected = True
        mock_adapter.disconnect = AsyncMock(return_value=None)

        runner = _mock_gateway_runner({Platform.TELEGRAM: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/telegram/disconnect")
            assert resp.status == 200
            data = await resp.json()
            assert data["name"] == "telegram"
            assert data["connected"] is False
            mock_adapter.disconnect.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_disconnect_platform_no_runner(self, adapter):
        """POST /api/gateway/platforms/{name}/disconnect returns 503."""
        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/test/disconnect")
            assert resp.status == 503

    @pytest.mark.asyncio
    async def test_disconnect_platform_not_found(self, adapter):
        """POST /api/gateway/platforms/{name}/disconnect returns 404."""
        runner = _mock_gateway_runner({})
        app = _create_cron_app(adapter, gateway_runner=runner)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/nobody/disconnect")
            assert resp.status == 404

    @pytest.mark.asyncio
    async def test_disconnect_platform_already_disconnected(self, adapter):
        """POST returns 409 when platform already disconnected."""
        mock_adapter = MagicMock()
        mock_adapter.name = "slack"
        mock_adapter.is_connected = False

        runner = _mock_gateway_runner({Platform.SLACK: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/slack/disconnect")
            assert resp.status == 409

    @pytest.mark.asyncio
    async def test_disconnect_platform_requires_auth(self, auth_adapter):
        """Returns 401 without API key."""
        app = _create_cron_app(auth_adapter, gateway_runner=MagicMock())
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/gateway/platforms/x/disconnect")
            assert resp.status == 401


# ---------------------------------------------------------------------------
# Gateway: PATCH /api/gateway/platforms/{name}
# ---------------------------------------------------------------------------

class TestUpdatePlatform:
    @pytest.mark.asyncio
    async def test_update_platform(self, adapter, tmp_path, monkeypatch):
        """PATCH /api/gateway/platforms/{name} updates config."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        from utils import atomic_yaml_write

        def fake_write(path, data):
            import yaml
            with open(path, "w") as fh:
                yaml.dump(data, fh)

        config = {"platforms": {"telegram": {"type": "telegram", "token": "old"}}}
        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump(config, fh)

        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            with patch("gateway.platforms.api_server.atomic_yaml_write", side_effect=fake_write):
                resp = await cli.patch(
                    "/api/gateway/platforms/telegram",
                    json={"token": "new-token"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["name"] == "telegram"

    @pytest.mark.asyncio
    async def test_update_platform_not_found(self, adapter, tmp_path, monkeypatch):
        """PATCH returns 404 when platform config doesn't exist."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        config = {"platforms": {}}
        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump(config, fh)

        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.patch(
                "/api/gateway/platforms/missing",
                json={"token": "x"},
            )
            assert resp.status == 404

    @pytest.mark.asyncio
    async def test_update_platform_invalid_json(self, adapter, tmp_path, monkeypatch):
        """PATCH with bad JSON returns 400."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump({"platforms": {"x": {"type": "y"}}}, fh)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.patch(
                "/api/gateway/platforms/x",
                data="not-json",
                headers={"Content-Type": "application/json"},
            )
            assert resp.status == 400

    @pytest.mark.asyncio
    async def test_update_platform_requires_auth(self, auth_adapter, tmp_path, monkeypatch):
        """PATCH returns 401 without API key."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump({"platforms": {"x": {"type": "y"}}}, fh)

        app = _create_cron_app(auth_adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.patch(
                "/api/gateway/platforms/x",
                json={"token": "new"},
            )
            assert resp.status == 401


# ---------------------------------------------------------------------------
# Gateway: DELETE /api/gateway/platforms/{name}
# ---------------------------------------------------------------------------

class TestRemovePlatform:
    @pytest.mark.asyncio
    async def test_remove_platform(self, adapter, tmp_path, monkeypatch):
        """DELETE /api/gateway/platforms/{name} removes platform from config."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        config = {"platforms": {"telegram": {"type": "telegram"}}}
        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump(config, fh)

        runner = MagicMock()
        runner.adapters = {}
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:

            def fake_write(path, data):
                import yaml
                with open(path, "w") as fh:
                    yaml.dump(data, fh)

            with patch("gateway.platforms.api_server.atomic_yaml_write", side_effect=fake_write):
                resp = await cli.delete("/api/gateway/platforms/telegram")
                assert resp.status == 204

    @pytest.mark.asyncio
    async def test_remove_platform_not_found(self, adapter, tmp_path, monkeypatch):
        """DELETE returns 404 when platform doesn't exist in config."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        config = {"platforms": {"other": {"type": "slack"}}}
        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump(config, fh)

        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.delete("/api/gateway/platforms/missing")
            assert resp.status == 404

    @pytest.mark.asyncio
    async def test_remove_platform_from_running_runner(self, adapter, tmp_path, monkeypatch):
        """DELETE also stops and removes adapter from running runner."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        config = {"platforms": {"telegram": {"type": "telegram"}}}
        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump(config, fh)

        mock_adapter = MagicMock()
        mock_adapter.name = "telegram"
        mock_adapter.is_connected = True
        mock_adapter.disconnect = AsyncMock(return_value=None)

        runner = _mock_gateway_runner({Platform.TELEGRAM: mock_adapter})
        app = _create_cron_app(adapter, gateway_runner=runner)

        async with TestClient(TestServer(app)) as cli:

            def fake_write(path, data):
                import yaml
                with open(path, "w") as fh:
                    yaml.dump(data, fh)

            with patch("gateway.platforms.api_server.atomic_yaml_write", side_effect=fake_write):
                resp = await cli.delete("/api/gateway/platforms/telegram")
                assert resp.status == 204
                mock_adapter.disconnect.assert_awaited_once()
                assert Platform.TELEGRAM not in runner.adapters

    @pytest.mark.asyncio
    async def test_remove_platform_no_runner_no_disconnect(self, adapter, tmp_path, monkeypatch):
        """DELETE succeeds even when runner is None (config-only removal)."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        config = {"platforms": {"telegram": {"type": "telegram"}}}
        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump(config, fh)

        app = _create_cron_app(adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:

            def fake_write(path, data):
                import yaml
                with open(path, "w") as fh:
                    yaml.dump(data, fh)

            with patch("gateway.platforms.api_server.atomic_yaml_write", side_effect=fake_write):
                resp = await cli.delete("/api/gateway/platforms/telegram")
                assert resp.status == 204

    @pytest.mark.asyncio
    async def test_remove_platform_requires_auth(self, auth_adapter, tmp_path, monkeypatch):
        """DELETE returns 401 without API key."""
        hermes_home = tmp_path / ".hermes"
        hermes_home.mkdir(parents=True)
        monkeypatch.setenv("HERMES_HOME", str(hermes_home))

        cfg_path = hermes_home / "config.yaml"
        with open(cfg_path, "w") as fh:
            import yaml
            yaml.dump({"platforms": {"x": {"type": "y"}}}, fh)

        app = _create_cron_app(auth_adapter, gateway_runner=None)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.delete("/api/gateway/platforms/x")
            assert resp.status == 401
