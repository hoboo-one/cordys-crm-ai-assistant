(() => {
  const host = document.createElement("span");
  host.style.display = "inline-flex";
  const ui = host.attachShadow({mode: "open"});
  ui.innerHTML = `
    <style>
      :host{font:14px/1.55 "Microsoft YaHei",system-ui,sans-serif;color:#173638}
      *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}
      #launch{display:inline-flex;align-items:center;gap:6px;border:1px solid #9dcece;border-radius:5px;background:#effafa;color:#116d71;padding:4px 10px;white-space:nowrap}
      #launch:hover{background:#ddf3f2}dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(440px,100vw);height:100%;max-height:100%;max-width:100%;padding:0;border:0;color:inherit;background:#fff;box-shadow:-8px 0 40px #1233}
      dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#152d3226}
      header,footer{padding:18px 22px}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dbe7e6}
      h2,h3,p{margin:0}h2{font-size:19px}h3{font-size:18px;margin:10px 0 4px}
      #close{border:0;background:none;font-size:24px;color:#567172}main{padding:18px 22px;flex:1;overflow:auto}
      .hint,small{color:#526d70}.reply{margin:15px 0;background:#f2f8f7;padding:15px;border-radius:9px;overflow-wrap:anywhere}.reply p{margin:6px 0}
      .bubble{margin:18px 0 5px auto;padding:8px 12px;background:#dcf1ef;border-radius:9px;width:fit-content}
      summary{cursor:pointer;padding:6px 0;color:#11696b}details article{border-top:1px solid #cddfdd;padding:9px 0}
      footer{border-top:1px solid #dae5e4}form{display:flex;gap:8px}input{flex:1;min-width:0;border:1px solid #adc5c5;border-radius:5px;padding:8px}
      #go{background:#137b80;border:0;color:white;padding:8px 15px;border-radius:5px}#go:disabled{opacity:.55}
    </style>
    <button id="launch" aria-haspopup="dialog">✧ AI 小助手</button>
    <dialog aria-labelledby="title"><header><h2 id="title">AI 小助手</h2><button id="close" aria-label="关闭">×</button></header>
    <main><p class="hint" id="order-context">可以直接提问，也可以查询订单并继续追问。</p><button id="new-chat" type="button">新对话</button><div id="history" aria-live="polite"></div></main>
    <footer><form><input maxlength="1000" aria-label="订单号或问题" placeholder="输入你的问题" autocomplete="off" required><button id="go">发送</button></form></footer></dialog>
    `;
  const $ = selector => ui.querySelector(selector);
  const dialog = $("dialog");
  const history = $("#history");
  const input = $("input");
  const plans = document.createElement("main");
  plans.id = "crm-followup-page";
  plans.hidden = true;
  plans.setAttribute("aria-label","跟进待办");
  const page = plans.attachShadow({mode:"open"});
  page.innerHTML = `
    <style>
      :host{flex:1;min-width:0;height:100%;overflow:auto;background:#eef1f2;color:#253538;font:14px/1.5 "Microsoft YaHei",system-ui,sans-serif}
      :host([hidden]){display:none} *{box-sizing:border-box}
      .panel{margin:16px;min-height:calc(100% - 32px);display:flex;flex-direction:column;background:white;border:1px solid #e4e9ea;border-radius:6px}
      .toolbar,footer{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:16px;flex-wrap:wrap}
      h1,h2{margin:0;font-size:18px;font-weight:600}.toolbar label{display:grid;gap:4px;color:#516466;font-size:12px}
      .filters,footer div{display:flex;gap:8px;align-items:end;flex-wrap:wrap}button,select,input,textarea{font:inherit;color:inherit;border:1px solid #d4ddde;border-radius:4px;background:white;padding:5px 10px}
      .filters input{width:145px}.filters input,.filters select{font-size:14px;color:#253538}
      button{cursor:pointer}button:hover:not(:disabled){color:#117779;border-color:#639d9e}button:disabled{opacity:.5;cursor:default}
      .table{overflow:auto;flex:1;margin:0 16px}table{width:100%;border-collapse:collapse;min-width:940px;text-align:left}
      th,td{padding:10px;border-bottom:1px solid #e7edee}th{background:#f6f8f8;color:#516466;font-weight:600}
      th,td{white-space:nowrap}td:first-child{font-variant-numeric:tabular-nums;color:#506265}
      tbody tr:hover{background:#f8fbfb}.state{display:inline-block;color:#165b76;background:#eaf4fb;border-radius:4px;padding:3px 7px}
      .state.completed{color:#236441;background:#e8f4ec}.state.neutral{color:#576366;background:#edf0f1}.state.problem{color:#944411;background:#fff1df}
      .reference,.note-preview{display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis}.note-preview{color:#516466}
      .note-alert{margin-top:3px;color:#a35716;font-size:12px}
      .actions{display:flex;align-items:center;gap:6px}.action{color:#116e71}.danger{color:#a83232}.primary{background:#147d82;color:white;border-color:#147d82}
      .empty{text-align:center;color:#627476;padding:30px}footer{border-top:1px solid #e7edee;color:#526467;padding-right:58px}
      #notice:not(:empty),.form-error:not(:empty){margin:0 16px 12px;color:#845019}
      .plan-dialog{width:min(500px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #d4ddde;border-radius:8px;padding:20px;color:inherit}
      .plan-dialog::backdrop{background:#182a3255}.dialog-header,.dialog-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .dialog-actions{justify-content:flex-end;margin-top:16px}.detail-facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 12px;margin:16px 0}
      .detail-facts dt{color:#516466}.detail-facts dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
      .plan-form{display:grid;gap:10px;border-top:1px solid #e7edee;padding-top:12px}.plan-form label{display:grid;gap:4px}
      .plan-form textarea{width:100%;resize:vertical}.plan-form[hidden]{display:none}.plan-dialog .form-error:not(:empty){margin:6px 0}
    </style>
    <div class="panel">
      <div class="toolbar">
        <h1 id="followup-heading" tabindex="-1">跟进待办</h1>
        <form class="filters" id="plan-filters">
          <label>待办编号<input id="plan-id" placeholder="完整待办编号" inputmode="numeric" pattern="[0-9]{1,24}" maxlength="24"></label>
          <label>客户<input id="customer" placeholder="客户名称或编号" maxlength="100"></label>
          <label>订单号 / 运单号<input id="reference" placeholder="搜索订单或运单" maxlength="64"></label>
          <label>系统异常<select id="issue"><option value="">全部</option><option value="label_only">只有面单</option>
            <option value="pending_sync">已交接 · 轨迹待同步</option><option value="no_pickup">暂无揽收记录</option>
            <option value="logistics_error">物流暂不可用</option><option value="unknown">暂未取得证据</option></select></label>
          <label>人工交接<select id="handoff"><option value="">全部</option><option>待核实</option><option>未交接</option><option>已交接</option></select></label>
          <label>待办进度<select id="status"><option value="OPEN">未完成</option><option value="ALL">全部</option>
            <option value="PREPARED">未开始</option><option value="UNDERWAY">跟进中</option><option value="COMPLETED">已完成</option>
            <option value="CANCELLED">已取消</option><option value="ARCHIVED">已删除</option></select></label>
          <button type="submit" class="primary">搜索</button><button id="clear-filters" type="button">清空</button><button id="refresh" type="button">刷新</button></form>
      </div>
      <div id="notice" role="status"></div>
      <div class="table"><table aria-label="我的跟进计划">
        <thead><tr><th>待办编号</th><th>跟进内容</th><th>客户</th><th>系统物流</th><th>人工交接</th><th>待办进度</th><th>核实备注</th><th>操作</th></tr></thead>
        <tbody id="plans-list"></tbody>
      </table></div>
      <footer><span id="total"></span><div><button id="prev" type="button">上一页</button><span id="page-number"></span><button id="next" type="button">下一页</button></div></footer>
    </div>
    <dialog id="plan-detail" class="plan-dialog" aria-labelledby="detail-heading">
      <div class="dialog-header"><h2 id="detail-heading">待办详情</h2><button id="close-detail" type="button">关闭</button></div>
      <dl class="detail-facts" id="detail-facts"></dl>
      <form id="handoff-form" class="plan-form">
        <label>交接结果<select name="outcome"><option value="unverified">待核实</option><option value="not_handed_off">未交接</option><option value="handed_off">已交接</option></select></label>
        <label>反馈来源<select name="source"><option value="">请选择</option><option value="warehouse">仓库</option><option value="carrier">承运商</option><option value="other">其他</option></select></label>
        <label>核实备注<textarea name="note" rows="3" maxlength="400" placeholder="补充确认人、时间或待处理事项（选填）"></textarea></label>
        <p class="form-error" id="detail-error" role="status"></p>
        <div class="dialog-actions"><button type="submit" class="primary">保存交接记录</button></div>
      </form>
    </dialog>
    <dialog id="plan-delete" class="plan-dialog" aria-labelledby="delete-heading">
      <div class="dialog-header"><h2 id="delete-heading">删除待办</h2></div>
      <p id="delete-message"></p><p class="form-error" id="delete-error" role="status"></p>
      <div class="dialog-actions"><button id="delete-cancel" type="button" autofocus>取消</button><button id="delete-confirm" type="button" class="danger">确认删除</button></div>
    </dialog>`;
  const pageFind = selector => page.querySelector(selector);
  const styles = document.createElement("style");
  styles.textContent = `
    .crm-followup-covered{display:none!important}
    .n-menu:has(.crm-followup-link[aria-current="page"]) .n-menu-item-content--selected::before{background:transparent}
    .crm-followup-link[aria-current="page"],.crm-followup-link:hover{background:#e7f4f4!important;color:#137c81!important}
  `;
  document.head.append(styles);
  const nav = document.createElement("button");
  nav.textContent = "☑　跟进待办";
  nav.title = "跟进待办";
  nav.className = "crm-followup-link";
  nav.type = "button";
  nav.style.cssText = "display:block;width:calc(100% - 16px);margin:4px 8px;padding:9px 16px;text-align:left;white-space:nowrap;overflow:hidden;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:4px";
  let planPage = 1, generation = 0;
  let search = {id:"",customer:"",reference:""};
  let covered, mountedMenu;
  const pageSize = 15;
  const statusNames = {PREPARED:"未开始",UNDERWAY:"跟进中",COMPLETED:"已完成",CANCELLED:"已取消"};
  const dateFormat = new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  function messageRow(text) {
    const row = document.createElement("tr");
    line(row,"td",text,"empty").colSpan = 8;
    pageFind("#plans-list").replaceChildren(row);
  }
  async function nativeCall(path, payload) {
    const token = session;
    const res = await fetch(path,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",
      "X-Auth-Token":token,"CSRF-Token":localStorage.getItem("csrfToken") || ""},body:JSON.stringify(payload)});
    const data = await res.json();
    if (token !== localStorage.getItem("sessionId")) throw Error();
    if (!res.ok || data.code !== 100200) throw Error(data.error || "");
    return data.data;
  }
  const handoffNames = {unverified:"待核实",not_handed_off:"未交接",handed_off:"已交接"};
  const sourceNames = {warehouse:"仓库",carrier:"承运商",other:"其他"};
  const issueNames = {label_only:"只有面单",pending_sync:"已交接 · 轨迹待同步",no_pickup:"暂无揽收记录",
    logistics_error:"物流暂不可用",unknown:"暂未取得证据"};

  function formatPlanDate(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? dateFormat.format(date) : "—";
  }

  function makeSelect(cell, label, values, value) {
    const select = line(cell,"select","");
    select.setAttribute("aria-label",label);
    for (const [key, name] of Object.entries(values)) {
      const option = line(select,"option",name);
      option.value = key;
    }
    select.value = value;
    return select;
  }

  async function updateTodo(plan, action, fields, message) {
    await nativeCall("/_local_assistant/plan",{id:plan.id,action,...fields});
    if (!plans.hidden) pageFind("#notice").textContent = message;
  }

  function showPlanDetails(plan, proposedOutcome) {
    const modal = pageFind("#plan-detail"), facts = pageFind("#detail-facts");
    const form = pageFind("#handoff-form"), error = pageFind("#detail-error");
    const {outcome,source,note} = form.elements;
    const record = plan.record, fact = plan.fact;
    const fields = [
      ["待办编号",plan.id],["跟进内容",plan.content],["负责人",plan.ownerName],["计划跟进时间",formatPlanDate(plan.estimatedTime)],
      ["订单号",plan.order_id],["运单号",plan.tracking_no],["订单系统状态",fact?.order_status],
      ["物流查询结果",fact?.state],["仓库备注",fact?.warehouse_note],
      ["仓库更新时间",formatPlanDate(fact?.warehouse_updated_at)],
      ["物流轨迹",fact?.events?.map(e => (e.event || e.event_type) + " · " + formatPlanDate(e.event_time)).join("\n")],
      ["查询时间",formatPlanDate(fact?.checked_at)],
      ["人工交接记录",record.outcome && [handoffNames[record.outcome_code],sourceNames[record.source] || "来源未记录",
        plan.ownerName,formatPlanDate(record.changed_at),record.note].filter(Boolean).join(" · ")]
    ];
    if (plan.archived_at) fields.push(["删除时间",formatPlanDate(plan.archived_at)]);
    if (record.conflict) fields.push(["记录提醒","备注与交接结果不一致，请向反馈方核对后修正。"]);
    facts.replaceChildren();
    for (const [label,value] of fields) {
      line(facts,"dt",label);
      line(facts,"dd",value || "—");
    }
    form.hidden = !plan.order_id || !!plan.archived_at;
    form.reset();
    outcome.value = proposedOutcome || record.outcome_code || "unverified";
    source.value = record.source || "";
    note.value = record.note || "";
    error.textContent = "";
    const submit = form.querySelector('button[type="submit"]');
    form.onsubmit = async event => {
      event.preventDefault();
      if (outcome.value !== "unverified" && !source.value) {
        error.textContent = "请选择反馈来源。";
        source.focus();
        return;
      }
      submit.disabled = true;
      error.textContent = "";
      try {
        await updateTodo(plan,"handoff",{outcome:outcome.value,source:source.value,note:note.value.trim()},"交接记录已保存。");
        modal.close();
        if (!plans.hidden) await loadPlans();
      } catch (failure) {
        error.textContent = failure.message || "交接记录未保存，请刷新后重试。";
      } finally {
        submit.disabled = false;
      }
    };
    modal.showModal();
    if (proposedOutcome && !source.value) source.focus();
  }

  function confirmPlanDeletion(plan) {
    const modal = pageFind("#plan-delete"), error = pageFind("#delete-error"), confirm = pageFind("#delete-confirm");
    pageFind("#delete-message").textContent = "删除待办 " + plan.id + "？之后可在「已删除」中恢复。";
    error.textContent = "";
    confirm.onclick = async () => {
      confirm.disabled = true;
      try {
        await updateTodo(plan,"archive",{},"待办已删除，可在「已删除」中恢复。");
        modal.close();
        if (!plans.hidden) await loadPlans();
      } catch (failure) {
        error.textContent = failure.message || "删除失败，请刷新后重试。";
      } finally {
        confirm.disabled = false;
      }
    };
    modal.showModal();
  }

  pageFind("#close-detail").onclick = () => pageFind("#plan-detail").close();
  pageFind("#delete-cancel").onclick = () => pageFind("#plan-delete").close();

  function renderPlan(list, plan) {
    const row = line(list,"tr","");
    const record = plan.record;
    line(row,"td",plan.id);
    const content = line(row,"td","");
    const reference = line(content,"span",plan.order_id
      ? plan.order_id + " · " + plan.tracking_no : plan.content || "—","reference");
    reference.title = plan.content || "";
    line(row,"td",plan.customerName || "—");
    const logistics = issueNames[plan.issue] || plan.fact?.state || "—";
    line(line(row,"td",""),"span",logistics,"state " + (plan.issue ? "problem" : plan.fact ? "completed" : "neutral"));
    const handoff = line(row,"td","");
    const handoffValue = record.outcome_code || "unverified";
    if (plan.order_id && !plan.archived_at) {
      const select = makeSelect(handoff,"人工交接 " + plan.id,handoffNames,handoffValue);
      select.onchange = () => {
        const next = select.value;
        select.value = handoffValue;
        showPlanDetails(plan,next);
      };
    } else {
      line(handoff,"span",plan.order_id ? handoffNames[handoffValue] : "—","state neutral");
    }
    const progress = line(row,"td","");
    if (!plan.archived_at && plan.status !== "CANCELLED" && statusNames[plan.status]) {
      const {CANCELLED,...activeStatuses} = statusNames;
      const select = makeSelect(progress,"待办进度 " + plan.id,activeStatuses,plan.status);
      select.onchange = async () => {
        select.disabled = true;
        try {
          await updateTodo(plan,"progress",{progress:select.value},"待办进度已更新。");
          if (!plans.hidden) await loadPlans();
        } catch (failure) {
          select.value = plan.status;
          pageFind("#notice").textContent = failure.message || "进度更新失败，请刷新后重试。";
        } finally {
          select.disabled = false;
        }
      };
    } else {
      line(progress,"span",statusNames[plan.status] || plan.status || "—","state neutral");
    }
    const noteCell = line(row,"td","");
    const preview = line(noteCell,"span",record.note || "—","note-preview");
    preview.title = record.note || "";
    if (record.conflict) line(noteCell,"small","交接与备注待核对","note-alert");
    const operation = line(line(row,"td",""),"div","","actions");
    line(operation,"button","详情","action").onclick = () => showPlanDetails(plan);
    if (plan.archived_at) {
      const restore = line(operation,"button","恢复","action");
      restore.onclick = async () => {
        restore.disabled = true;
        try {
          await updateTodo(plan,"restore",{},"待办已恢复。切换到「全部」可查看。");
          if (!plans.hidden) await loadPlans();
        } catch (failure) {
          pageFind("#notice").textContent = failure.message || "恢复失败，请刷新后重试。";
        } finally {
          restore.disabled = false;
        }
      };
    } else {
      line(operation,"button","删除","danger").onclick = () => confirmPlanDeletion(plan);
    }
  }

  async function loadPlans() {
    const ticket = ++generation, list = pageFind("#plans-list");
    messageRow("正在读取跟进计划…");
    pageFind("#total").textContent = pageFind("#page-number").textContent = "";
    pageFind("#prev").disabled = pageFind("#next").disabled = true;
    try {
      const filter = pageFind("#status").value;
      const archived = filter === "ARCHIVED";
      const res = await nativeCall("/_local_assistant/problems",{...search,status:pageFind("#handoff").value,
        issue:pageFind("#issue").value,progress:archived ? "ALL" : filter,archived,page:planPage});
      if (ticket !== generation) return;
      const lastPage = Math.max(1,Math.ceil(res.total / pageSize));
      if (planPage > lastPage) {
        planPage = lastPage;
        return loadPlans();
      }
      list.replaceChildren();
      if (!res.list.length) messageRow(archived ? "暂无已删除的待办" : "暂无符合条件的跟进待办");
      for (const plan of res.list) renderPlan(list,plan);
      pageFind("#total").textContent = "共 " + res.total + " 条";
      pageFind("#page-number").textContent = planPage + " / " + lastPage;
      pageFind("#prev").disabled = planPage <= 1;
      pageFind("#next").disabled = planPage >= lastPage;
    } catch (failure) {
      if (ticket === generation) messageRow(failure.message || "无法读取跟进待办，请刷新重试。");
    }
  }
  function syncPlans(sider) {
    const content = sider?.nextElementSibling;
    const visible = !!content && content !== plans && new URL(location.href).searchParams.get("followup") === "1";
    if (!visible) {
      if (covered) {
        covered.classList.remove("crm-followup-covered");
        covered = undefined;
      }
      if (!plans.hidden) {
        plans.hidden = true;
        pageFind("#plan-detail").close();
        pageFind("#plan-delete").close();
        generation++;
        pageFind("#plans-list").replaceChildren();
        pageFind("#notice").textContent = "";
        nav.removeAttribute("aria-current");
      }
      return;
    }
    if (covered !== content || plans.parentNode !== content.parentNode) {
      covered?.classList.remove("crm-followup-covered");
      covered = content;
      content.classList.add("crm-followup-covered");
      content.after(plans);
    }
    if (plans.hidden) {
      nav.setAttribute("aria-current","page");
      plans.hidden = false;
      planPage = 1;
      pageFind("#plan-filters").reset();
      search = {id:"",customer:"",reference:""};
      loadPlans();
    }
  }
  function openPlans() {
    dialog.close();
    const url = new URL(location.href);
    if (url.searchParams.get("followup") !== "1") {
      url.searchParams.set("followup","1");
      window.history.pushState(window.history.state,"",url);
    }
    mount();
    pageFind("#followup-heading").focus();
  }
  function leavePlans(event) {
    if (plans.hidden || nav.contains(event.target)) return;
    const url = new URL(location.href);
    url.searchParams.delete("followup");
    window.history.replaceState(window.history.state,"",url);
    syncPlans();
  }
  nav.onclick = openPlans;
  pageFind("#prev").onclick = () => {planPage--;loadPlans();};
  pageFind("#next").onclick = () => {planPage++;loadPlans();};
  pageFind("#refresh").onclick = loadPlans;
  function changeFilter() {
    planPage = 1;
    pageFind("#notice").textContent = "";
    loadPlans();
  }
  pageFind("#status").onchange = pageFind("#handoff").onchange = pageFind("#issue").onchange = changeFilter;
  pageFind("#plan-filters").onsubmit = event => {
    event.preventDefault();
    search = {id:pageFind("#plan-id").value.trim(),customer:pageFind("#customer").value.trim(),
      reference:pageFind("#reference").value.trim()};
    changeFilter();
  };
  pageFind("#clear-filters").onclick = () => {
    pageFind("#plan-filters").reset();
    search = {id:"",customer:"",reference:""};
    changeFilter();
  };
  let session, controller, chatId;
  function setOrderContext(number) {
    $("#order-context").textContent = number ? "当前订单 " + number + "，可以直接追问或委托跟进。"
      : "可以直接提问，也可以查询订单并继续追问。";
  }
  function clearChat() {
    controller?.abort();
    controller = undefined;
    chatId = undefined;
    history.replaceChildren();
    setOrderContext(undefined);
    input.value = "";
    $("#go").disabled = false;
  }
  let openOnLogin = new URLSearchParams(location.search).get("assistant") === "open";
  function reset() {
    dialog.close();
    syncPlans();nav.remove();
    clearChat();
  }
  function mount() {
    const toolbar = document.querySelector(".n-layout-header .crm-button-group");
    const active = localStorage.getItem("sessionId");
    if (session !== active || !toolbar) {
      reset();
      session = active;
    }
    if (!toolbar || !active || location.hash.includes("/login")) {
      host.remove();
    } else if (host.parentNode !== toolbar) {
      toolbar.prepend(host);
    }
    const menu = document.querySelector(".n-menu.n-menu--vertical");
    if (host.isConnected && menu) {
      if (nav.parentNode !== menu) menu.append(nav);
      if (mountedMenu !== menu) {
        mountedMenu?.removeEventListener("click",leavePlans,true);
        mountedMenu = menu;
        menu.addEventListener("click",leavePlans,true);
      }
    }
    syncPlans(host.isConnected ? menu?.closest(".crm-layout-sider") : null);
    if (openOnLogin && host.isConnected && active) {
      openOnLogin = false;
      dialog.showModal();
      input.focus();
    }
  }
  new MutationObserver(mount).observe(document.body, {childList:true, subtree:true});
  window.addEventListener("hashchange", mount);
  window.addEventListener("popstate", mount);
  window.addEventListener("storage", mount);
  mount();
  $("#launch").onclick = () => { dialog.showModal(); input.focus(); };
  $("#close").onclick = () => dialog.close();
  $("#new-chat").onclick = () => {clearChat();input.focus();};
  function line(parent, tag, value, style) {
    const el = document.createElement(tag);
    el.textContent = value;
    if (style) el.className = style;
    parent.append(el);
    return el;
  }
  function render(reply, data) {
    reply.replaceChildren();
    line(reply, "strong", data.summary);
    for (const action of data.actions || []) line(reply,"p",action);
    if (data.history_unavailable) line(reply,"p","历史待办暂时无法读取。","hint");
    for (const parcel of data.packages) {
      if (parcel.open_plan) line(reply,"p",parcel.tracking_no + " · 未完成待办 " + parcel.open_plan.id);
      const previous = parcel.previous_plan;
      if (previous) line(reply,"p",parcel.tracking_no + " · 上次待办 " + previous.id + " · "
        + (previous.outcome ? previous.outcome + " · " + previous.note
          : previous.status === "CANCELLED" ? "已取消" : "已完成，未记录核实结果"));
      if (parcel.next_step && data.intent !== "follow") line(reply,"p",parcel.tracking_no + " · 建议：" + parcel.next_step);
    }
    if (data.intent === "follow") line(reply,"button","查看跟进待办").onclick = openPlans;
    if (data.intent === "advise" && data.actions?.[0]?.startsWith("建议跟进运单")) {
      line(reply,"button","有必要就创建待办").onclick = () => {
        input.value = "根据查询结果，有必要就帮我跟进 " + data.order.order_id;
        $("form").requestSubmit();
      };
    }
    if (data.intent === "clarify") {
      for (const phrase of ["只查进度","帮我跟进"]) {
        line(reply,"button",phrase).onclick = () => {
          input.value = phrase+" "+data.order.order_id;
          $("form").requestSubmit();
        };
      }
    }
    if (data.analysis?.text) {
      line(reply, "p", "DeepSeek 解读");
      const answer = line(reply, "p", data.analysis.text);
      answer.style.whiteSpace = "pre-line";
    } else if (data.analysis?.notice) {
      line(reply, "p", data.analysis.notice, "hint");
    }
    const details = document.createElement("details");
    reply.append(details);
    line(details, "summary", "查看依据");
    const order = data.order;
    line(details, "p", order.order_id + " · " + order.customer_id + " · " + order.order_status);
    for (const parcel of data.packages) {
      const box = document.createElement("article");
      details.append(box);
      line(box, "strong", parcel.tracking_no + " · " + parcel.state);
      line(box, "p", parcel.shipment_id + " " + parcel.updated_at.replace("T"," ").slice(0,16) + "　" + parcel.remark);
      for (const event of parcel.events) {
        line(box, "p", event.event_id + " " + event.event_time.replace("T"," ").slice(0,16) + "　" + event.event);
      }
    }
  }
  $("form").onsubmit = async event => {
    event.preventDefault();
    if (controller) return;
    const msg = input.value.trim();
    if (!msg) return;
    line(history, "p", msg, "bubble");
    const reply = line(history, "section", "正在回复…", "reply");
    input.value = "";
    reply.scrollIntoView({block:"nearest"});
    chatId ||= crypto.randomUUID();
    const pending = new AbortController();
    controller = pending;
    $("#go").disabled = true;
    try {
      const res = await fetch("/_local_assistant/chat", {
        method:"POST", signal:pending.signal, credentials:"same-origin",
        headers:{"Content-Type":"application/json","X-Auth-Token":session,"CSRF-Token":localStorage.getItem("csrfToken") || ""},
        body:JSON.stringify({chat_id:chatId, message:msg})
      });
      const data = await res.json();
      if (controller !== pending || session !== localStorage.getItem("sessionId")) return;
      if (res.ok) {
        setOrderContext(data.current_order);
        if (data.evidence) render(reply, {...data.evidence, analysis:{text:data.text}});
        else {
          reply.textContent = data.text;
          reply.style.whiteSpace = "pre-line";
        }
      }
      else {
        const trace = res.headers.get("X-Request-ID");
        reply.textContent = (data.error || "查询失败，请重试。") + (trace ? " 请求编号：" + trace : "");
      }
    } catch (error) {
      if (!pending.signal.aborted) reply.textContent = "暂时无法连接排查服务，请重试。";
    } finally {
      if (controller === pending) {
        controller = undefined;
        $("#go").disabled = false;
        reply.scrollIntoView({block:"nearest"});
        if (dialog.open) input.focus();
      }
    }
  };
})();
