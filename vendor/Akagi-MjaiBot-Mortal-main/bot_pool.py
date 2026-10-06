"""Serve several independent Mortal seats from one shared model process."""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import socketserver
import sys
import threading

from bot import Bot


# The Mortal engine keeps mutable inference buffers.  Keep requests ordered while
# still allowing every TCP connection to own an independent Bot/PlayerState.
_react_lock = threading.Lock()
_http_bots: dict[str, Bot] = {}
_http_bots_lock = threading.Lock()


class BotRequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        bot = Bot()
        peer = f"{self.client_address[0]}:{self.client_address[1]}"
        sys.stderr.write(f"bot connected: {peer}\n")
        sys.stderr.flush()

        for raw in self.rfile:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                with _react_lock:
                    response = bot.react(line)
            except Exception as exc:  # Keep one seat failure from killing all seats.
                sys.stderr.write(f"bot error ({peer}): {exc}\n")
                sys.stderr.flush()
                response = json.dumps({"type": "none"}, separators=(",", ":"))

            self.wfile.write(response.encode("utf-8") + b"\n")
            self.wfile.flush()

            try:
                events = json.loads(line)
            except Exception:
                continue
            if any(event.get("type") == "end_game" for event in events):
                break


class BotPoolServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class AdvisorRequestHandler(BaseHTTPRequestHandler):
    """Small localhost-only HTTP bridge used by the desktop recommendation UI."""

    server_version = "MortalAdvisor/1.0"

    def _headers(self, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_OPTIONS(self) -> None:
        self._headers(204)

    def do_POST(self) -> None:
        if self.path != "/react":
            self._headers(404)
            self.wfile.write(b'{"error":"not found"}')
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            session = str(payload.get("session", "desktop"))
            events = payload.get("events")
            if not isinstance(events, list) or not events:
                raise ValueError("events must be a non-empty list")

            with _http_bots_lock:
                bot = _http_bots.setdefault(session, Bot())
            with _react_lock:
                result = bot.react(json.dumps(events, separators=(",", ":")))
            if any(event.get("type") == "end_game" for event in events):
                with _http_bots_lock:
                    _http_bots.pop(session, None)

            self._headers()
            self.wfile.write(result.encode("utf-8"))
        except Exception as exc:
            sys.stderr.write(f"advisor error: {exc}\n")
            sys.stderr.flush()
            self._headers(400)
            self.wfile.write(json.dumps({"error": str(exc)}).encode("utf-8"))

    def log_message(self, format: str, *args: object) -> None:
        return


def serve_advisor(port: int) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), AdvisorRequestHandler)
    server.daemon_threads = True
    sys.stderr.write(f"Mortal advisor HTTP listening on 127.0.0.1:{port}\n")
    sys.stderr.flush()
    server.serve_forever(poll_interval=0.2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--http-port", type=int)
    args = parser.parse_args()

    if args.http_port is not None:
        threading.Thread(target=serve_advisor, args=(args.http_port,), daemon=True).start()

    with BotPoolServer((args.host, args.port), BotRequestHandler) as server:
        sys.stderr.write(f"shared Mortal pool listening on {args.host}:{args.port}\n")
        sys.stderr.flush()
        server.serve_forever(poll_interval=0.2)


if __name__ == "__main__":
    main()
