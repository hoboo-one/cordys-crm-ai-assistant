"""python verify.py —— 逐单核对线上响应与测试数据，以及所有凭证拒绝场景。"""
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent

def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))

clients = read("crm-connections.json")
def call(system, params, token):
    headers = {"Authorization": "Bearer " + token} if token else {}
    req = Request(clients[system]["local_url"] + "?" + urlencode(params), headers=headers)
    try:
        with urlopen(req, timeout=5) as resp:
            return resp.status, json.load(resp)
    except HTTPError as err:
        return err.code, json.load(err)

def check_rows(system, params, expected):
    code, data = call(system, params, clients[system]["token"])
    assert code == 200 and data["count"] == len(expected) and data["items"] == expected, (system, params)

orders, ships, events = [read("data/" + name + ".json") for name in clients]
assert (len(orders), len(ships), len(events)) == (40, 50, 80)
assert len({o["order_id"] for o in orders}) == 40
assert len({(s["carrier"],s["tracking_no"]) for s in ships}) == 50
assert {s["order_id"] for s in ships} <= {o["order_id"] for o in orders}
assert {(e["carrier"],e["tracking_no"]) for e in events} == {(s["carrier"],s["tracking_no"]) for s in ships}
for order in orders:
    query = {"order_id":order["order_id"]}
    check_rows("orders", query, [order])
    check_rows("warehouse", query, [s for s in ships if s["order_id"] == order["order_id"]])
for shipment in ships:
    query = {key:shipment[key] for key in ("carrier","tracking_no")}
    check_rows("logistics", query, [e for e in events if all(e[k] == v for k,v in query.items())])
for system, client in clients.items():
    params = {"order_id":"O-102"} if system != "logistics" else query
    for token in [None, "invalid"] + [c["token"] for name,c in clients.items() if name != system]:
        assert call(system, params, token)[0] == 401, system
    assert call(system, {}, client["token"])[0] == 400
check_rows("logistics", {"carrier":"JD","tracking_no":"SF90000001"}, [])
assert call("orders", {"order_id":"O-999"}, clients["orders"]["token"])[0] == 404
print("PASS: 40 orders, 50 parcels, 80 events; data links, valid/invalid/cross-service tokens and error responses.")
