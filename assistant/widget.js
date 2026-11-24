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
      h1{margin:0;font-size:18px;font-weight:600}.toolbar label{display:flex;align-items:center;gap:8px}
      .filters,footer div{display:flex;gap:8px;align-items:center;flex-wrap:wrap}button,select{font:inherit;color:inherit;border:1px solid #d4ddde;border-radius:4px;background:white;padding:5px 10px}
      .filters input{font:inherit;width:160px;border:1px solid #d4ddde;border-radius:4px;padding:5px 8px}
      button{cursor:pointer}button:hover:not(:disabled){color:#117779;border-color:#639d9e}button:disabled{opacity:.5;cursor:default}
      .table{overflow:auto;flex:1;margin:0 16px}table{width:100%;border-collapse:collapse;min-width:790px;text-align:left}
      th,td{padding:12px 10px;border-bottom:1px solid #e7edee}th{background:#f6f8f8;color:#516466;font-weight:600;white-space:nowrap}
      td:nth-child(n+3){white-space:nowrap}td:first-child{font-variant-numeric:tabular-nums;color:#506265}
      tbody tr:hover{background:#f8fbfb}.state{color:#165b76;background:#eaf4fb;border-radius:4px;padding:3px 7px}
      .state.completed{color:#236441;background:#e8f4ec}.state.cancelled{color:#576366;background:#edf0f1}
      .state.problem{color:#944411;background:#fff1df}
      .action{color:#116e71}.empty{text-align:center;color:#627476;padding:30px}footer{border-top:1px solid #e7edee;color:#526467;padding-right:58px}
      #notice:not(:empty){margin:0 16px 12px;color:#845019}
      .completion-form{display:grid;gap:8px;white-space:normal;min-width:220px;margin-top:8px}
      .completion-form label{display:grid;gap:4px}.completion-form textarea{font:inherit;width:100%;padding:6px;border:1px solid #d4ddde;border-radius:4px;resize:vertical}
      .result-cell{white-space:normal!important;overflow-wrap:anywhere;min-width:110px}
    </style>
    <div class="panel">
      <div class="toolbar">
        <h1 id="followup-heading" tabindex="-1">跟进待办</h1>
        <form class="filters" id="plan-filters">
          <label for="plan-id">待办编号</label><input id="plan-id" placeholder="完整待办编号" inputmode="numeric" pattern="[0-9]{1,24}" maxlength="24">
          <label for="customer">客户</label><input id="customer" placeholder="客户名称或编号" maxlength="100">
          <label for="handoff">交接核实状态</label><select id="handoff">
          <option value="">全部记录</option><option>待处理问题</option><option>未交接</option>
          <option>待核实</option><option>暂未核实</option><option>未记录</option><option>已交接</option>
        </select><label for="status">待办进度</label><select id="status">
          <option value="ALL">全部</option><option value="PREPARED">未开始</option>
          <option value="UNDERWAY">进行中</option><option value="COMPLETED">已完成</option>
          <option value="CANCELLED">已取消</option>
        </select><button type="submit">搜索</button><button id="clear-filters" type="button">清空筛选</button><button id="refresh" type="button">刷新</button></form>
      </div>
      <div id="notice" role="status"></div>
      <div class="table"><table aria-label="我的跟进计划">
        <thead><tr><th>待办编号</th><th>跟进内容</th><th>关联客户</th><th>负责人</th><th>计划跟进时间</th><th>待办进度</th><th>交接核实状态</th><th>核实备注</th><th>操作</th></tr></thead>
        <tbody id="plans-list"></tbody>
      </table></div>
      <footer><span id="total"></span><div><button id="prev" type="button">上一页</button><span id="page-number"></span><button id="next" type="button">下一页</button></div></footer>
    </div>`;
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
  let search = {id:"",customer:""};
  let covered, mountedMenu;
  const pageSize = 15;
  const statusNames = {PREPARED:"未开始",UNDERWAY:"进行中",COMPLETED:"已完成",CANCELLED:"已取消"};
  const dateFormat = new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  function messageRow(text) {
    const row = document.createElement("tr");
    line(row,"td",text,"empty").colSpan = 9;
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
  function showCompletion(operation, plan, done, recorded) {
    done.hidden = true;
    const form = line(operation,"form","","completion-form");
    form.innerHTML = `
      <label>核实结果<select name="outcome" required><option value="">请选择</option>
      <option value="handed_off">已交接</option><option value="not_handed_off">未交接</option>
      <option value="unverified">暂未核实</option></select></label>
      <label>核实备注<textarea name="note" rows="3" maxlength="400" required></textarea></label>
      <div><button type="submit">保存并完成</button> <button type="button">取消</button></div>`;
    const cancel = form.querySelector('button[type="button"]');
    const submit = form.querySelector('button[type="submit"]');
    const {outcome,note} = form.elements;
    if (recorded) {
      outcome.value = recorded.outcome_code;
      note.value = recorded.note;
      submit.textContent = "保存修改";
    }
    cancel.onclick = () => {form.remove();done.hidden=false;done.focus();};
    outcome.focus();
    form.onsubmit = async event => {
      event.preventDefault();
      const text = note.value.trim();
      if (!text) {note.focus();return;}
      const result = outcome.value;
      outcome.disabled = note.disabled = submit.disabled = cancel.disabled = true;
      pageFind("#notice").textContent = "";
      try {
        await nativeCall("/_local_assistant/complete",{id:String(plan.id),outcome:result,note:text,edit:!!recorded});
        if (!plans.hidden && form.isConnected) {
          pageFind("#notice").textContent = recorded ? "待办 " + plan.id + " 的核实结果已更新。"
            : "待办 " + plan.id + " 已保存核实结果并完成。";
          await loadPlans();
        }
      } catch (error) {
        if (!plans.hidden && form.isConnected) pageFind("#notice").textContent =
          error.message || "未能确认保存结果，请重试或刷新列表核对。";
      } finally {
        outcome.disabled = note.disabled = submit.disabled = cancel.disabled = false;
      }
    };
  }
  async function loadPlans() {
    const ticket = ++generation, list = pageFind("#plans-list");
    messageRow("正在读取跟进计划…");
    pageFind("#total").textContent = pageFind("#page-number").textContent = "";
    pageFind("#prev").disabled = pageFind("#next").disabled = true;
    try {
      const wanted = pageFind("#handoff").value;
      const progress = pageFind("#status").value;
      const res = wanted || search.id || search.customer
        ? await nativeCall("/_local_assistant/problems",{...search,status:wanted,progress,page:planPage})
        : await nativeCall("/personal/center/follow/plan/list",{sourceId:"NULL",status:progress,myPlan:true,current:planPage,pageSize});
      if (ticket !== generation) return;
      const lastPage = Math.max(1,Math.ceil(res.total / pageSize));
      if (planPage > lastPage) {
        planPage = lastPage;
        return loadPlans();
      }
      const completedIds = res.list.filter(plan => plan.status === "COMPLETED").map(plan => String(plan.id));
      const results = completedIds.length
        ? await nativeCall("/_local_assistant/results",{ids:completedIds}).catch(() => null) : {};
      if (ticket !== generation) return;
      list.replaceChildren();
      if (!res.list.length) messageRow("暂无跟进待办");
      for (const plan of res.list) {
        const row = line(list,"tr","");
        for (const value of [plan.id,plan.content,plan.customerName,plan.ownerName,
          Number.isFinite(plan.estimatedTime) && plan.estimatedTime > 0 ? dateFormat.format(plan.estimatedTime) : "—"]) {
          line(row,"td",value || "—");
        }
        line(line(row,"td",""),"span",statusNames[plan.status] || plan.status,"state cancelled");
        const recorded = results?.[plan.id];
        const handoff = plan.handoff_state || recorded?.outcome
          || (plan.status === "COMPLETED" ? (results ? "未记录" : "读取失败") : plan.status === "CANCELLED" ? "—" : "待核实");
        const tone = handoff === "已交接" ? "completed" : ["未交接","暂未核实","待核实"].includes(handoff) ? "problem" : "cancelled";
        line(line(row,"td",""),"span",handoff,"state " + tone);
        line(row,"td",recorded?.note || "—","result-cell");
        const operation = line(row,"td","");
        if (plan.type === "CUSTOMER" && ["PREPARED","UNDERWAY"].includes(plan.status)) {
          const done = line(operation,"button","标记完成","action");
          done.onclick = () => showCompletion(operation,plan,done);
        } else if (plan.status === "COMPLETED" && recorded) {
          const edit = line(operation,"button","编辑核实结果","action");
          edit.onclick = () => showCompletion(operation,plan,edit,recorded);
          if (/^联系仓库，核实 O-\d+ 运单 \S+ 是否已交接$/.test(plan.content) &&
              (recorded.outcome_code !== "handed_off" || recorded.due_at)) {
            addReviewControls(operation,plan,recorded);
          }
        } else {
          operation.textContent = "—";
        }
      }
      pageFind("#total").textContent = "共 " + res.total + " 条";
      pageFind("#page-number").textContent = planPage + " / " + lastPage;
      pageFind("#prev").disabled = planPage <= 1;
      pageFind("#next").disabled = planPage >= lastPage;
    } catch {if (ticket === generation) messageRow("无法读取跟进待办，请刷新重试。");}
  }
  function addReviewControls(operation, plan, record) {
    const panel = line(operation,"div","","completion-form");
    if (record.due_at) {
      const overdue = record.due_at <= Date.now();
      line(panel,"span",(overdue ? "已到复查时间 · " : "下次复查 · ") + dateFormat.format(record.due_at),
        overdue ? "state problem" : "");
    }
    if (record.review_summary) line(panel,"p",record.review_summary);
    const due = document.createElement("input");
    due.type = "datetime-local";
    due.setAttribute("aria-label","下次复查时间");
    panel.append(due);
    const schedule = line(panel,"button","保存复查时间");
    const check = line(panel,"button","立即复查");
    async function submit(payload) {
      schedule.disabled = check.disabled = true;
      try {
        const result = await nativeCall("/_local_assistant/review",{id:String(plan.id),...payload});
        if (!panel.isConnected) return;
        pageFind("#notice").textContent = result.summary || "已保存下次复查时间。";
        await loadPlans();
      } catch (error) {
        if (panel.isConnected) pageFind("#notice").textContent = error.message || "复查操作失败，请重试。";
      } finally {
        schedule.disabled = check.disabled = false;
      }
    }
    schedule.onclick = () => {
      const timestamp = new Date(due.value).getTime();
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
        pageFind("#notice").textContent = "请选择将来的复查时间。";
        due.focus();
        return;
      }
      submit({due_at:timestamp});
    };
    check.onclick = () => submit({});
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
      search = {id:"",customer:""};
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
  pageFind("#status").onchange = pageFind("#handoff").onchange = changeFilter;
  pageFind("#plan-filters").onsubmit = event => {
    event.preventDefault();
    search = {id:pageFind("#plan-id").value.trim(),customer:pageFind("#customer").value.trim()};
    changeFilter();
  };
  pageFind("#clear-filters").onclick = () => {
    pageFind("#plan-filters").reset();
    search = {id:"",customer:""};
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
