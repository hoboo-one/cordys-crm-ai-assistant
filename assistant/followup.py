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
PROGRESS = OPEN | {"COMPLETED", "CANCELLED"}
SOURCES = {"warehouse", "carrier", "other"}
ISSUES = {"label_only", "pending_sync", "no_pickup", "logistics_error", "unknown"}
ORDER_PLAN = re.compile(r"联系仓库，核实 (O-[0-9]{1,12}) 运单 (\S+) 是否已交接")


def warehouse_next_step(parcel):
    current = parcel.get("open_plan") or {}
    previous = current if current.get("outcome") else (parcel.get("previous_plan") or {})
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


def metadata_table(db):
    db.execute("""CREATE TABLE IF NOT EXISTS plan_metadata
                  (plan_id TEXT PRIMARY KEY, owner TEXT NOT NULL,
                   source TEXT NOT NULL DEFAULT '', archived_at INTEGER)""")


def read_metadata(ids, owner=None):
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    sql = f"SELECT plan_id, source, archived_at FROM plan_metadata WHERE plan_id IN ({placeholders})"
    params = list(ids)
    if owner is not None:
        sql += " AND owner=?"
        params.append(owner)
    with closing(sqlite3.connect(DB)) as db:
        metadata_table(db)
        return {plan_id: {"source": source, "archived_at": archived_at}
                for plan_id, source, archived_at in db.execute(sql, params)}


def plan_reference(row):
    match = ORDER_PLAN.fullmatch(row.get("content") or "") if row.get("type") == "CUSTOMER" else None
    return match.groups() if match else (None, None)


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


def save_result(db, plan_id, user, outcome, note, previous, force=False):
    if previous == (user, outcome, note) and not force:
        return
    db.execute("""INSERT INTO plan_result_changes
                  (plan_id,actor,changed_at,previous_outcome,previous_note,outcome,note)
                  VALUES (?,?,?,?,?,?,?)""",
               (plan_id,user,int(time.time()*1000),*(previous[1:] if previous else (None,None)),outcome,note))
    db.execute("INSERT OR REPLACE INTO plan_results VALUES (?,?,?,?)", (plan_id,user,outcome,note))


def complete_plan(auth, user, plan_id, outcome, note, edit=False):
    with WRITE_LOCK, closing(sqlite3.connect(DB)) as db:
        plan = crm(auth, "/account/follow/plan/get/" + plan_id)
        if not plan or plan["owner"] != user or plan["type"] != "CUSTOMER":
            raise CRMError(100403)
        if read_metadata([plan_id], owner=user).get(plan_id, {}).get("archived_at"):
            raise CRMError(100409)
        result_table(db)
        saved = db.execute("SELECT owner, outcome, note FROM plan_results WHERE plan_id=?", (plan_id,)).fetchone()
        if edit:
            if plan["status"] != "COMPLETED" or not saved:
                raise CRMError(100409)
            if saved[0] != user:
                raise CRMError(100403)
            save_result(db,plan_id,user,outcome,note,saved)
            db.commit()
            return
        if plan["status"] == "COMPLETED" and saved == (user, outcome, note):
            return
        if plan["status"] not in OPEN:
            raise CRMError(100409)
        save_result(db,plan_id,user,outcome,note,saved)
        db.commit()
        crm(auth, "/account/follow/plan/status/update", {"id":plan_id,"status":"COMPLETED"})


def manage_plan(auth, user, plan_id, action, values):
    with WRITE_LOCK, closing(sqlite3.connect(DB)) as db, db:
        path = "/account/follow/plan/get/" + plan_id
        plan = crm(auth, path)
        if not plan or plan.get("owner") != user:
            raise CRMError(100403)
        metadata_table(db)
        saved = db.execute("SELECT source, archived_at FROM plan_metadata WHERE plan_id=? AND owner=?",
                           (plan_id, user)).fetchone()
        source, archived_at = saved or ("", None)
        if action in {"archive", "restore"}:
            archive_time = (archived_at or int(time.time() * 1000)) if action == "archive" else None
            db.execute("""INSERT INTO plan_metadata (plan_id,owner,archived_at) VALUES (?,?,?)
                          ON CONFLICT(plan_id) DO UPDATE SET owner=excluded.owner, archived_at=excluded.archived_at""",
                       (plan_id, user, archive_time))
            return
        if archived_at:
            raise CRMError(100409)
        if action == "progress":
            status = values["progress"]
            if plan["status"] != status:
                crm(auth, "/account/follow/plan/status/update", {"id": plan_id, "status": status})
                if crm(auth, path).get("status") != status:
                    raise CRMError(100409)
            return
        if not plan_reference(plan)[0]:
            raise CRMError(100400)
        result_table(db)
        previous = db.execute("SELECT owner,outcome,note FROM plan_results WHERE plan_id=?", (plan_id,)).fetchone()
        if previous and previous[0] != user:
            raise CRMError(100403)
        new_source = values["source"]
        save_result(db, plan_id, user, values["outcome"], values["note"], previous, force=source != new_source)
        db.execute("""INSERT INTO plan_metadata (plan_id,owner,source) VALUES (?,?,?)
                      ON CONFLICT(plan_id) DO UPDATE SET owner=excluded.owner, source=excluded.source""",
                   (plan_id, user, new_source))


def read_history(result, customer, auth):
    by_content = {handoff_content(result["order"]["order_id"], p["tracking_no"]): p
                  for p in result["packages"]}
    if not customer or not by_content:
        return
    rows = customer_plans(auth, customer, by_content)
    ids = [str(row["id"]) for row in rows]
    records = read_results(ids)
    metadata = read_metadata(ids)
    for row in rows:
        parcel = by_content[row["content"]]
        plan_id = str(row["id"])
        info = metadata.get(plan_id, {})
        if info.get("archived_at"):
            continue
        field = "open_plan" if row["status"] in OPEN else "previous_plan"
        if row["status"] in OPEN or row["status"] in {"COMPLETED", "CANCELLED"}:
            parcel.setdefault(field, {"id":plan_id,"status":row["status"],
                                       "created_at":row.get("createTime"), "source":info.get("source"),
                                       **records.get(plan_id,{})})


def plan_issue(fact, record):
    if not fact:
        return "unknown"
    if fact["state"] == "物流查询失败":
        return "logistics_error"
    if fact["state"] == "已揽收":
        return ""
    if record.get("outcome_code") == "handed_off" and not record.get("conflict"):
        return "pending_sync"
    events = fact.get("events") or []
    return "label_only" if events and all(e["event_type"] == "LABEL_CREATED" for e in events) else "no_pickup"


def conflicting_handoff(record):
    state = record.get("outcome")
    if state not in {"已交接", "未交接"}:
        return False
    claimed = re.match(r"\s*(?:(?:仓库|承运商)(?:确认|反馈)[\s:：,，]*)?(已交接|未交接)(?=$|[\s，,。；;])",
                       record.get("note", ""))
    return bool(claimed and claimed.group(1) != state)


def filter_plans(auth, user, page, size, wanted, progress, plan_id, customer,
                 reference="", issue="", archived=False, facts=None):
    records = []
    current = 1
    while True:
        data = crm(auth, "/personal/center/follow/plan/list",
                   {"sourceId":"NULL", "status":"ALL" if progress == "OPEN" or archived else progress,
                    "myPlan":True, "current":current, "pageSize":50})
        records.extend(data["list"])
        if current * 50 >= data["total"]:
            break
        current += 1
    records.sort(key=lambda row: (row.get("createTime") or 0, str(row["id"])), reverse=True)
    ids = [str(row["id"]) for row in records]
    metadata = read_metadata(ids, owner=user)
    results = read_results(ids, owner=user)
    matched = []
    for row in records:
        row_id = str(row["id"])
        info = metadata.get(row_id, {})
        if bool(info.get("archived_at")) != archived or (plan_id and row_id != plan_id):
            continue
        allowed_status = progress == "ALL" or row["status"] == progress or (progress == "OPEN" and row["status"] in OPEN)
        if not archived and not allowed_status:
            continue
        if customer and not any(customer in str(row.get(field) or "").casefold() for field in ("customerName", "customerId")):
            continue
        order, tracking = plan_reference(row)
        if reference and not any(reference in value.casefold() for value in (order, tracking) if value):
            continue
        record = results.get(row_id, {})
        state = record.get("outcome") or ("待核实" if row["status"] in OPEN else "未记录")
        if wanted and not (state == wanted or (wanted == "待处理问题" and state != "已交接")
                           or (wanted == "待核实" and state in {"暂未核实", "未记录"})):
            continue
        matched.append({**row, "id":row_id, "order_id":order, "tracking_no":tracking,
                        "record":{**record, "source":info.get("source", ""), "conflict":conflicting_handoff(record)},
                        "archived_at":info.get("archived_at")})

    def annotate(rows):
        resolved = facts(rows) if facts else {}
        for row in rows:
            row["fact"] = resolved.get(row["id"])
            row["issue"] = plan_issue(row["fact"], row["record"]) if row["order_id"] else ""

    if issue:
        annotate(matched)
        matched = [row for row in matched if row["issue"] == issue]
    result = matched[(page-1)*size:page*size]
    if not issue:
        annotate(result)
    return {"list": result, "total":len(matched)}


def ensure_plan(auth, user, customer, order, parcel, reopen):
    tracking = parcel["tracking_no"]
    content = handoff_content(order, tracking)
    key = json.dumps([order, parcel["carrier"], tracking, "warehouse_handoff"])
    with WRITE_LOCK, closing(sqlite3.connect(DB)) as db:
        db.execute("CREATE TABLE IF NOT EXISTS plans (business_key TEXT PRIMARY KEY, plan_id TEXT)")
        known = db.execute("SELECT plan_id FROM plans WHERE business_key=?", (key,)).fetchone()
        archived_known = known and known[0] and read_metadata([known[0]]).get(known[0], {}).get("archived_at")
        if known and known[0] and not archived_known:
            old = crm(auth, "/account/follow/plan/get/" + known[0])
            if old["customerId"] != customer:
                return "客户归属待核实，本次未新建。"
            if old["status"] in OPEN:
                return "已有待办 · " + known[0]
            if old["status"] not in {"COMPLETED", "CANCELLED"}:
                return "原待办状态待核实，本次未新建。"
        history = customer_plans(auth, customer, {content})
        metadata = read_metadata([str(row["id"]) for row in history])
        visible = [row for row in history if not metadata.get(str(row["id"]), {}).get("archived_at")]
        archived_history = bool(history and not visible)
        history = visible
        existing = next((str(row["id"]) for row in history if row["status"] in OPEN), None)
        if existing:
            db.execute("INSERT OR REPLACE INTO plans VALUES (?,?)", (key,existing))
            db.commit()
            return "已有待办 · " + existing
        if archived_known or archived_history:
            return "这票待办已删除，可在「已删除」列表中恢复。"
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
