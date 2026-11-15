"""Independent laptop website host: UI files plus a bounded robot-API bridge.

This project needs only Python's standard library. It imports no robot/CV,
Webots, serial, GPIO or motor code. The Pi runs the API, not this website.
Original integration; HTTP/URL APIs: https://docs.python.org/3/library/http.server.html
and https://docs.python.org/3/library/urllib.request.html . See CREDITS.md.
"""

import argparse
import copy
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent


class Website:
    """Presentation/transport only; the robot owns every motion decision."""

    def __init__(
        self, robot_url, port=8890, preview=False, test_controls=False, camera_port=8879
    ):
        """Connect through local SSH forwards rather than expose control publicly."""
        parsed = urllib.parse.urlsplit(robot_url)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or not parsed.port
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError(
                "robot_url must be a loopback HTTP API, e.g. http://127.0.0.1:8891"
            )
        self.robot_url = robot_url.rstrip("/")
        self.port, self.preview, self.test_controls = port, preview, test_controls
        self.camera_port = camera_port
        self.token = secrets.token_urlsafe(24)
        self.closing = threading.Event()
        self.lock = threading.Lock()
        self.robot_session = None
        self.faults = {
            name: False
            for name in (
                "cellular_offline",
                "gnss_lost",
                "gnss_uncertain",
                "esp_link_lost",
                "camera_blocked",
                "power_loss",
            )
        }

    def fetch_json(self, path):
        """Read only fixed robot endpoints with bounded size and timeout."""
        with urllib.request.urlopen(self.robot_url + path, timeout=2) as response:
            body = response.read(2 * 1024 * 1024 + 1)
        if len(body) > 2 * 1024 * 1024:
            raise ValueError("Robot response is too large")
        return json.loads(body)

    def session(self):
        """Use a separate browser token; never expose the Pi's API token."""
        try:
            robot = None if self.preview else self.fetch_json("/api/session")
        except (OSError, ValueError):
            robot = None
        with self.lock:
            self.robot_session = robot
        return dict(
            token=self.token,
            server_time_ms=(
                robot["server_time_ms"] if robot else round(time.time() * 1000)
            ),
            website_service=True,
            preview_mode=self.preview,
            robot_api_url=self.robot_url,
        )

    def state(self):
        """Offline is an error, not a fabricated position or successful delivery."""
        if self.preview:
            with self.lock:
                faults = dict(self.faults)
            return dict(
                ready=False,
                preview=True,
                simulation=True,
                website_test_controls_allowed=self.test_controls,
                control_snapshot_age_s=0,
                connection_ok=False,
                faults=faults,
                mission=dict(
                    state="idle",
                    destination=None,
                    reason="Website preview only; no robot connected",
                    route_pixels=[],
                    events=[],
                    pose=None,
                    remaining_m=0,
                ),
                navigation=dict(
                    state="STOP", reason="Website preview only; no robot connected"
                ),
                localization_fault="No robot connected",
                modem=dict(fix_age_s=None, cellular_latency_s=0.2),
                performance={},
                camera_health={},
            )
        data = self.fetch_json("/api/state")
        data["website_test_controls_allowed"] = (
            self.test_controls and data.get("simulation") is True
        )
        return data

    def command(self, value):
        """Forward an intentional command once; never replay a motion request."""
        if not isinstance(value, dict):
            raise ValueError("Expected a JSON object")
        action = value.get("action")
        if action == "close_preview" and self.preview:
            self.closing.set()
            return dict(accepted=True)
        if self.preview:
            if action == "heartbeat":
                return dict(accepted=True)
            if action == "test_fault" and self.test_controls:
                name, enabled = value.get("fault"), value.get("enabled")
                if name not in self.faults or not isinstance(enabled, bool):
                    raise ValueError("Invalid preview switch")
                with self.lock:
                    self.faults[name] = enabled
                return dict(accepted=True)
            raise ValueError("Website preview only; no robot is connected")
        if action == "test_fault" and not self.state()["website_test_controls_allowed"]:
            raise ValueError("Test controls are unavailable on a physical robot")
        with self.lock:
            session = copy.deepcopy(self.robot_session)
        if not session:
            session = self.fetch_json("/api/session")
            with self.lock:
                self.robot_session = session
        request = urllib.request.Request(
            self.robot_url + "/api/commands",
            data=json.dumps(value, allow_nan=False).encode(),
            headers={
                "Content-Type": "application/json",
                "X-Delivery-Token": session["token"],
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return json.loads(response.read(64 * 1024))
        except urllib.error.HTTPError as error:
            if error.code == 403:
                with self.lock:
                    self.robot_session = None
                raise ValueError(
                    "Robot session restarted; reload the website before sending a new command"
                ) from error
            raise ValueError(
                json.loads(error.read(64 * 1024)).get(
                    "error", "Robot rejected the command"
                )
            ) from error

    def camera(self, path):
        """Proxy only JSON/JPEG camera data; the Pi serves no viewer files."""
        with self.lock:
            session = copy.deepcopy(self.robot_session)
        if not session:
            try:
                session = self.fetch_json("/api/session")
            except (OSError, ValueError):
                session = {"camera_port": self.camera_port}
        port = session["camera_port"]
        if not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError("Invalid robot camera port")
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}" + path, timeout=2
        ) as response:
            body = response.read(10 * 1024 * 1024 + 1)
        if len(body) > 10 * 1024 * 1024:
            raise ValueError("Camera response is too large")
        return body


def start_website(website):
    """Host the independent website on the laptop's loopback interface."""
    authority = f"127.0.0.1:{website.port}"

    class Handler(BaseHTTPRequestHandler):
        """Exact route allowlists; no arbitrary proxy targets or filesystem paths."""

        def log_message(self, *_):
            """Keep routine polling out of the website console."""

        def reply(self, status, payload, kind="application/json"):
            """Use the same-origin website for all scripts, frames and commands."""
            body = (
                json.dumps(payload, allow_nan=False).encode()
                if kind == "application/json"
                else payload
            )
            self.send_response(status)
            for key, value in [
                ("Content-Type", kind),
                ("Cache-Control", "no-store"),
                ("X-Content-Type-Options", "nosniff"),
                ("Content-Length", str(len(body))),
                (
                    "Content-Security-Policy",
                    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
                ),
                ("X-VisionDetect-Service", "separate-website"),
            ]:
                self.send_header(key, value)
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            """Serve UI locally; ask the robot only for observations and map data."""
            if self.headers.get("Host") != authority:
                return self.reply(403, dict(error="Use the printed loopback address"))
            path = urllib.parse.urlsplit(self.path).path
            try:
                if path == "/api/session":
                    return self.reply(200, website.session())
                if path == "/api/state":
                    return self.reply(200, website.state())
                if path == "/api/map":
                    try:
                        data = (
                            None if website.preview else website.fetch_json("/api/map")
                        )
                    except (OSError, ValueError):
                        data = None
                    return self.reply(
                        200,
                        data
                        or json.loads(
                            (ROOT / "preview-map.json").read_text(encoding="utf-8")
                        ),
                    )
                if path == "/api/parts":
                    return self.reply(
                        200,
                        json.loads(
                            (ROOT / "assets/parts.json").read_text(encoding="utf-8")
                        ),
                    )
                if path in ("/camera/frame.jpg", "/frame.jpg"):
                    return self.reply(200, website.camera("/frame.jpg"), "image/jpeg")
                if path == "/api/detections":
                    return self.reply(
                        200, json.loads(website.camera("/api/detections"))
                    )
                assets = {
                    "/": ("assets/index.html", "text/html; charset=utf-8"),
                    "/app.js": ("assets/app.js", "text/javascript; charset=utf-8"),
                    "/app.css": ("assets/app.css", "text/css; charset=utf-8"),
                    "/cv": ("cv/index.html", "text/html; charset=utf-8"),
                    "/styles.css": ("cv/styles.css", "text/css; charset=utf-8"),
                    "/viewer.js": ("cv/viewer.js", "text/javascript; charset=utf-8"),
                }
                if path == "/test-controls.js" and website.test_controls:
                    assets[path] = (
                        "test-controls.js",
                        "text/javascript; charset=utf-8",
                    )
                if path not in assets:
                    return self.reply(404, dict(error="Not found"))
                filename, kind = assets[path]
                return self.reply(200, (ROOT / filename).read_bytes(), kind)
            except (OSError, ValueError) as error:
                return self.reply(
                    503,
                    dict(
                        error="Robot/camera connection unavailable", detail=str(error)
                    ),
                )

        def do_POST(self):
            """Browser authentication is separate from robot API authentication."""
            if (
                self.path != "/api/commands"
                or self.headers.get("Host") != authority
                or self.headers.get("Origin") not in (None, f"http://{authority}")
                or not secrets.compare_digest(
                    self.headers.get("X-Delivery-Token", ""), website.token
                )
            ):
                return self.reply(403, dict(error="Website session required"))
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError("Invalid request size")
                return self.reply(
                    202, website.command(json.loads(self.rfile.read(length)))
                )
            except (ValueError, TypeError) as error:
                return self.reply(400, dict(error=str(error)))
            except OSError:
                return self.reply(
                    503,
                    dict(error="Robot connection unavailable; command was not retried"),
                )

    server = ThreadingHTTPServer(("127.0.0.1", website.port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    """Run this on the laptop; never copy this project onto the Pi."""
    config = json.loads((ROOT / "website.json").read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--robot-url", default=config["robot_api_url"])
    parser.add_argument("--port", type=int, default=config["website_port"])
    parser.add_argument(
        "--camera-port",
        type=int,
        default=config["camera_port"],
        help="CV-only fallback when the delivery API is not running",
    )
    parser.add_argument(
        "--preview", action="store_true", help="Show UI only; no robot commands"
    )
    parser.add_argument(
        "--test-controls",
        action="store_true",
        help="Enable laptop-only test interface for simulation/preview",
    )
    args = parser.parse_args()
    site = Website(
        args.robot_url, args.port, args.preview, args.test_controls, args.camera_port
    )
    server = start_website(site)
    print(
        f"SEPARATE WEBSITE: http://127.0.0.1:{site.port} | "
        + ("PREVIEW ONLY" if site.preview else f"robot API {site.robot_url}"),
        flush=True,
    )
    try:
        while not site.closing.wait(0.5):
            pass
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
