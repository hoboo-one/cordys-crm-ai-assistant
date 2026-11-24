"""把只有面单的运单交给 Cordys 原生跟进计划。写入前持久化登记，以便丢包后核对。"""
import json
import re
import sqlite3
import time
from contextlib import closing
from threading import Lock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

DB = "/state/followup.sqlite"
WRITE_LOCK = Lock()
OPEN = {"PREPARED", "UNDERWAY"}
OUTCOMES = {"handed_off": "已交接", "not_handed_off": "未交接", "unverified": "暂未核实"}


def warehouse_next_step(parcel):
    previous = parcel.get("previous_plan") or {}
    if previous.get("outcome") != "未交接" or parcel["state"] == "已揽收":
        return None
    note = previous.get("note", "")
    if re.search(r"(?:还没|还未|尚未|没有|未|没)(?:完成)?(?:出库|打包|包装)|待(?:打包|出库)", note):
        return "仓库上次反馈未交接，备注显示仍卡在打包或出库。请向仓库确认阻塞原因、预计完成打包出库的时间和交接安排。"
    return "仓库上次确认未交接。请向仓库确认阻塞原因及预计交接时间。"


class CRMError(Exception):
    def __init__(self, code):
        self.code = code


def crm(auth, endpoint, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request("http://crm:8081" + endpoint, data=body,
                  headers={**auth, "Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=6) as resp:
            result = json.load(resp)
    except HTTPError as exc:
        with exc:
            if exc.code in (401, 403, 404):
                raise CRMError(100000 + exc.code) from exc
            if exc.code != 500:
                raise
            result = json.load(exc)
            if result.get("code") != 100500 or result.get("message") != "No operation permission":
                raise
    if result.get("code") == 100500 and result.get("message") == "No operation permission":
        raise CRMError(100403)
    if result.get("code") != 100200:
        raise CRMError(result.get("code"))
    return result.get("data")


def handoff_content(order, tracking):
    return f"联系仓库，核实 {order} 运单 {tracking} 是否已交接"


def customer_plans(auth, customer, contents):
    page = 1
    matches = []
    while True:
        data = crm(auth, "/account/follow/plan/page",
                   {"sourceId": customer, "status": "ALL", "current": page, "pageSize": 50})
        matches.extend(row for row in data["list"]
                       if row["content"] in contents and row["customerId"] == customer)
        if page * 50 >= data["total"]:
            return sorted(matches, key=lambda row: (row.get("createTime") or 0, str(row["id"])), reverse=True)
        page += 1


def result_table(db):
    db.execute("""CREATE TABLE IF NOT EXISTS plan_results
                  (plan_id TEXT PRIMARY KEY, owner TEXT NOT NULL, outcome TEXT NOT NULL, note TEXT NOT NULL)""")
    db.execute("""CREATE TABLE IF NOT EXISTS plan_result_changes
                  (change_id INTEGER PRIMARY KEY, plan_id TEXT NOT NULL, actor TEXT NOT NULL,
                   changed_at INTEGER NOT NULL, previous_outcome TEXT, previous_note TEXT,
                   outcome TEXT NOT NULL, note TEXT NOT NULL)""")
    db.execute("""CREATE TABLE IF NOT EXISTS plan_reviews
                  (plan_id TEXT PRIMARY KEY, due_at INTEGER NOT NULL, reviewed_at INTEGER, summary TEXT)""")


def read_results(ids, owner=None):
    if not ids:
        return {}
    with closing(sqlite3.connect(DB)) as db:
        result_table(db)
        params = list(ids)
        sql = """SELECT plan_results.plan_id, outcome, note,
                 (SELECT changed_at FROM plan_result_changes c WHERE c.plan_id=plan_results.plan_id
                 ORDER BY change_id DESC LIMIT 1),
                 r.due_at, r.reviewed_at, r.summary
                 FROM plan_results LEFT JOIN plan_reviews r USING (plan_id) WHERE plan_results.plan_id IN (""" + ",".join("?" for _ in ids) + ")"
        if owner is not None:
            sql += " AND owner=?"
            params.append(owner)
        return {plan_id: {"outcome": OUTCOMES[outcome], "outcome_code": outcome, "note": note,
                          "changed_at": changed_at,"due_at":due_at,"reviewed_at":reviewed_at,"review_summary":summary}
                for plan_id, outcome, note, changed_at,due_at,reviewed_at,summary in db.execute(sql, params)}


def update_review(plan_id, due_at=None, summary=None, resolved=False):
    with WRITE_LOCK, closing(sqlite3.connect(DB)) as db:
        result_table(db)
        if summary is None:
            db.execute("""INSERT INTO plan_reviews (plan_id,due_at) VALUES (?,?)
                          ON CONFLICT(plan_id) DO UPDATE SET due_at=excluded.due_at""",(plan_id,due_at))
        else:
            db.execute("""INSERT INTO plan_reviews VALUES (?,?,?,?)
                          ON CONFLICT(plan_id) DO UPDATE SET reviewed_at=excluded.reviewed_at,
                          summary=excluded.summary, due_at=CASE WHEN ? THEN 0 ELSE plan_reviews.due_at END""",
                       (plan_id,0,int(time.time()*1000),summary,resolved))
        db.commit()


def save_result(db, plan_id, user, outcome, note, previous):
    if previous == (user, outcome, note):
        return
    db.execute("""INSERT INTO plan_result_changes
                  (plan_id,actor,changed_at,previous_outcome,previous_note,outcome,note)
                  VALUES (?,?,?,?,?,?,?)""",
               (plan_id,user,int(time.time()*1000),*(previous[1:] if previous else (None,None)),outcome,note))
    db.execute("INSERT OR REPLACE INTO plan_results VALUES (?,?,?,?)", (plan_id,user,outcome,note))
    db.commit()


def complete_plan(auth, user, plan_id, outcome, note, edit=False):
    with WRITE_LOCK, closing(sqlite3.connect(DB)) as db:
        plan = crm(auth, "/account/follow/plan/get/" + plan_id)
        if not plan or plan["owner"] != user or plan["type"] != "CUSTOMER":
            raise CRMError(100403)
        result_table(db)
        saved = db.execute("SELECT owner, outcome, note FROM plan_results WHERE plan_id=?", (plan_id,)).fetchone()
        if edit:
            if plan["status"] != "COMPLETED" or not saved:
                raise CRMError(100409)
            if saved[0] != user:
                raise CRMError(100403)
            save_result(db,plan_id,user,outcome,note,saved)
            return
        if plan["status"] == "COMPLETED" and saved == (user, outcome, note):
            return
        if plan["status"] not in OPEN:
            raise CRMError(100409)
        save_result(db,plan_id,user,outcome,note,saved)
        crm(auth, "/account/follow/plan/status/update", {"id":plan_id,"status":"COMPLETED"})


def read_history(result, customer, auth):
    by_content = {handoff_content(result["order"]["order_id"], p["tracking_no"]): p
                  for p in result["packages"]}
    if not customer or not by_content:
        return
    rows = customer_plans(auth, customer, by_content)
    records = read_results([str(row["id"]) for row in rows if row["status"] == "COMPLETED"])
    for row in rows:
        parcel = by_content[row["content"]]
        field = "open_plan" if row["status"] in OPEN else "previous_plan"
        if row["status"] in OPEN or row["status"] in {"COMPLETED", "CANCELLED"}:
            plan_id = str(row["id"])
            parcel.setdefault(field, {"id":plan_id,"status":row["status"],
                                      "created_at":row.get("createTime"), **records.get(plan_id,{})})


def filter_plans(auth, user, page, size, wanted, progress, plan_id, customer):
    records = []
    current = 1
    while True:
        data = crm(auth, "/personal/center/follow/plan/list",
                   {"sourceId":"NULL","status":"ALL" if wanted else progress,"myPlan":True,"current":current,"pageSize":50})
        records.extend(data["list"])
        if current * 50 >= data["total"]:
            break
        current += 1
    records.sort(key=lambda row: (row.get("createTime") or 0, str(row["id"])), reverse=True)
    def matches(row):
        return ((not plan_id or str(row["id"]) == plan_id)
                and (not customer or any(customer in str(row.get(field) or "").casefold()
                                         for field in ("customerName","customerId")))
                and (progress == "ALL" or row["status"] == progress))

    if not wanted:
        matching = [row for row in records if matches(row)]
        return {"list":matching[(page-1)*size:page*size],"total":len(matching)}
    latest = {}
    for row in records:
        if row["type"] == "CUSTOMER" and row["content"].startswith("联系仓库，核实 ") and row["content"].endswith(" 是否已交接"):
            latest.setdefault((row["customerId"],row["content"]),row)
    results = read_results([str(row["id"]) for row in latest.values() if row["status"] == "COMPLETED"], owner=user)
    matched = []
    for row in latest.values():
        if not matches(row):
            continue
        outcome = results.get(str(row["id"]), {}).get("outcome")
        state = outcome or ("待核实" if row["status"] in OPEN else "未记录")
        if state == wanted or (wanted == "待处理问题" and state != "已交接"):
            row["handoff_state"] = state
            matched.append(row)
    return {"list": matched[(page-1)*size:page*size], "total":len(matched)}


def ensure_plan(auth, user, customer, order, parcel, reopen):
    tracking = parcel["tracking_no"]
    content = handoff_content(order, tracking)
    key = json.dumps([order, parcel["carrier"], tracking, "warehouse_handoff"])
    with WRITE_LOCK, closing(sqlite3.connect(DB)) as db:
        db.execute("CREATE TABLE IF NOT EXISTS plans (business_key TEXT PRIMARY KEY, plan_id TEXT)")
        known = db.execute("SELECT plan_id FROM plans WHERE business_key=?", (key,)).fetchone()
        if known and known[0]:
            old = crm(auth, "/account/follow/plan/get/" + known[0])
            if old["customerId"] != customer:
                return "客户归属待核实，本次未新建。"
            if old["status"] in OPEN:
                return "已有待办 · " + known[0]
            if old["status"] not in {"COMPLETED", "CANCELLED"}:
                return "原待办状态待核实，本次未新建。"
        history = customer_plans(auth, customer, {content})
        existing = next((str(row["id"]) for row in history if row["status"] in OPEN), None)
        if existing:
            db.execute("INSERT OR REPLACE INTO plans VALUES (?,?)", (key,existing))
            db.commit()
            return "已有待办 · " + existing
        if known and not known[0]:
            return "此前已发出创建请求，结果待核实，本次未重复提交。"
        if not reopen and (history or (known and known[0])):
            return "已有历史待办 · " + (str(history[0]["id"]) if history else known[0]) + "。如需再次核实，请明确要求重新跟进。"
        db.execute("INSERT OR REPLACE INTO plans VALUES (?,NULL)", (key,))
        db.commit()
        try:
            added = crm(auth, "/account/follow/plan/add", {
                "type":"CUSTOMER", "customerId":customer, "owner":user, "content":content,
                "method":"2", "estimatedTime":int(time.time()*1000), "moduleFields":[]})
        except CRMError as exc:
            if exc.code in (100401, 100403, 100400):
                db.execute("DELETE FROM plans WHERE business_key=?", (key,))
                db.commit()
            raise
        except OSError:
            # A request may have reached Cordys before the response was lost.
            previous_ids = {str(row["id"]) for row in history}
            refreshed = customer_plans(auth,customer,{content})
            recovered = next((row for row in refreshed if str(row["id"]) not in previous_ids and row["status"] in OPEN),None)
            if not recovered:
                return "创建结果待核实，重新发起前请在 Cordys 核对。"
            added = recovered
        plan_id = str(added["id"])
        db.execute("UPDATE plans SET plan_id=? WHERE business_key=?", (plan_id,key))
        db.commit()
        return "已创建待办 · " + plan_id


def needs_handoff_check(parcel):
    return (parcel["state"] == "暂无揽收记录" and bool(parcel["events"])
            and all(event["event_type"] == "LABEL_CREATED" for event in parcel["events"]))


def follow(result, customer, user, auth, selected, reopen=False):
    if not customer:
        return ["模拟客户尚未绑定 CRM，无法创建跟进待办。"]
    messages = []
    for parcel in result["packages"]:
        tracking = parcel["tracking_no"]
        next_step = warehouse_next_step(parcel)
        if next_step and not reopen:
            messages.append(tracking + "：" + next_step + " 本次未重复创建待办。")
        elif parcel["state"] == "物流查询失败":
            messages.append(tracking + "：物流状态待核实，本次未建待办。")
        elif parcel["shipment_id"] in selected and needs_handoff_check(parcel):
            try:
                message = ensure_plan(auth, user, customer, result["order"]["order_id"], parcel, reopen)
            except CRMError as exc:
                message = ("CRM 拒绝待办操作，请核对权限。" if exc.code in (100401,100403)
                           else "CRM 待办状态待核实，请查看跟进待办。")
            except (OSError, KeyError, TypeError, ValueError, sqlite3.Error):
                message = "本次未能确认 CRM 待办结果，请稍后核对。"
            messages.append(tracking + "：" + message)
        elif not parcel["events"]:
            messages.append(tracking + "：暂无物流轨迹，无法确认只有面单，本次未建待办。")
    if not result["packages"]:
        return [result["summary"] + "本次未创建待办。"]
    if selected or not any(needs_handoff_check(parcel) for parcel in result["packages"]):
        return messages or ["没有符合跟进条件的包裹，无需新建待办。"]
    return ["AI 判断本次无需创建跟进待办。", *messages]
