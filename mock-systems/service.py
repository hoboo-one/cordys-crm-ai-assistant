"""三个只读业务接口共用的 HTTP 入口；每个进程只挂载自己的数据与凭证。"""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


SYSTEM = os.environ["SYSTEM"]
ROUTES = {
    "orders": ("/api/orders", {"order_id"}),
    "warehouse": ("/api/shipments", {"order_id"}),
    "logistics": ("/api/tracking", {"carrier", "tracking_no"}),
}
ROUTE, FIELDS = ROUTES[SYSTEM]
RECORDS = json.loads(Path("/app/records.json").read_text(encoding="utf-8"))
TOKEN = Path("/run/mock-token").read_text(encoding="ascii").strip()
if len(TOKEN) < 32:
    raise ValueError("缺少有效的测试凭证")


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        if status == 401:
            self.send_header("WWW-Authenticate", "Bearer")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/health":
            return self.respond(200, {"system": SYSTEM, "status": "ok"})
        expected = ("Bearer " + TOKEN).encode()
        actual = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(actual, expected):
            return self.respond(401, {"error": "invalid_token"})
        if url.path != ROUTE:
            return self.respond(404, {"error": "unknown_endpoint"})
        params = parse_qs(url.query, keep_blank_values=True)
        if set(params) != FIELDS or any(len(v) != 1 or not v[0].strip() for v in params.values()):
            return self.respond(400, {"error": "invalid_parameters", "required": sorted(FIELDS)})
        rows = [r for r in RECORDS if all(r[k] == params[k][0] for k in FIELDS)]
        if SYSTEM == "orders" and not rows:
            return self.respond(404, {"error": "order_not_found"})
        return self.respond(200, {"system": SYSTEM, "count": len(rows), "items": rows})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
