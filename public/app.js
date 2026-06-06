/*
 * app.js — 일일수학 클론 메인 앱
 *  - 학생 모드 / 부모님 모드(비밀번호)
 *  - 출제, 스케줄, 정답확인, 제출기록, 성취도, 설정
 *  - numberpad 답 입력, 채점
 *  - 상태는 Cloudflare KV(/api/state)에 저장되어 여러 브라우저에서 공유된다.
 */
(function () {
  "use strict";

  const STORE_KEY = "ilmath_state_v2";
  const DEFAULT_PW = "kw20021163";
  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const WEEKDAY_KO = { sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토" };

  /* ---------- 상태 ---------- */
  let state = defaultState();
  let mode = "student";          // 'student' | 'parent'
  let parentUnlocked = false;    // 세션 동안만 유효
  let parentTab = "assign";      // 'assign' | 'schedule' | 'answers' | 'history' | 'achievement' | 'settings'
  let dirty = false;             // 로컬 변경이 서버에 아직 반영되지 않음
  let saveTimer = null;

  function defaultState() { return normalizeState({}); }
  function normalizeState(s) {
    s = s || {};
    return {
      password: s.password || DEFAULT_PW,
      schedule: s.schedule || {},
      scheduleOverrides: s.scheduleOverrides || {},
      assignment: s.assignment || null,
      issued: Array.isArray(s.issued) ? s.issued : [],
      history: Array.isArray(s.history) ? s.history : [],
    };
  }

  // 서버(KV)에서 상태 로드. 실패 시 localStorage 캐시 폴백.
  async function loadState() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        if (j && typeof j === "object") { cacheLocal(j); return normalizeState(j); }
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) {}
    return defaultState();
  }

  function cacheLocal(obj) { try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch (e) {} }

  // 로컬 즉시 저장 + 디바운스 서버 PUT
  function saveState() {
    cacheLocal(state);
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushState, 500);
  }
  function pushState() {
    const body = JSON.stringify(state);
    try {
      fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body })
        .then(() => { dirty = false; })
        .catch(() => {});
    } catch (e) {}
  }

  // 다른 브라우저의 변경을 반영(편집 중이 아닐 때만)
  async function refreshFromServer() {
    if (dirty || Numberpad.isOpen()) return;
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      if (j && typeof j === "object") {
        const next = JSON.stringify(normalizeState(j));
        if (next !== JSON.stringify(state)) { state = JSON.parse(next); cacheLocal(state); render(); }
      }
    } catch (e) {}
  }

  /* ---------- 날짜 헬퍼 ---------- */
  function dateKey(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function today() { return dateKey(new Date()); }
  function weekdayOf(dateStr) { return WEEKDAYS[new Date(dateStr + "T00:00:00").getDay()]; }
  function fmtDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[WEEKDAYS[d.getDay()]]})`;
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[WEEKDAYS[d.getDay()]]}) ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtTime(iso) { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}`; }

  /* ---------- 출제(assignment) 구성 ---------- */
  function buildAssignment(spec, dateStr) {
    if (!Array.isArray(state.issued)) state.issued = [];
    const exclude = new Set(state.issued);
    const problems = Curriculum.generateSet(spec.itemId, spec.count, exclude);
    const meta = Curriculum.itemMeta(spec.itemId);
    if (!problems || !meta) return null;
    // 이번에 출제한 문제 시그니처를 기록(이후 출제에서 중복 회피). 최근 2000개만 유지.
    problems.forEach((p) => state.issued.push(p.promptHtml));
    if (state.issued.length > 2000) state.issued = state.issued.slice(-2000);
    return { itemId: spec.itemId, count: spec.count, meta, problems, date: dateStr, status: "pending", answers: {}, result: null, locked: [] };
  }

  // 오늘의 문제 보장: 명시적 당일 출제가 있으면 유지, 없으면 스케줄/오버라이드로 생성
  function ensureTodayAssignment() {
    const t = today();
    if (state.assignment && state.assignment.date === t) return;
    const spec = state.scheduleOverrides[t] || state.schedule[weekdayOf(t)];
    if (spec && spec.itemId) {
      const a = buildAssignment(spec, t);
      if (a) { state.assignment = a; saveState(); return; }
    }
    if (state.assignment && state.assignment.date !== t) { state.assignment = null; saveState(); }
  }

  /* ---------- 채점 ---------- */
  function normalize(s) {
    if (s == null) return "";
    s = String(s).trim().replace(/^\+/, "");
    return s;
  }
  function answersEqual(a, b) {
    a = normalize(a); b = normalize(b);
    if (a === b) return true;
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return Math.abs(na - nb) < 1e-9 && a !== "" && b !== "";
    return false;
  }
  function grade(asg) {
    const wrong = [];
    let correct = 0;
    asg.problems.forEach((p) => {
      const ok = p.blanks.every((ans, bi) => answersEqual(asg.answers[p.id + "_" + bi], ans));
      if (ok) correct++; else wrong.push(p.id);
    });
    return { score: correct, total: asg.problems.length, wrong };
  }
  function totalBlanks(asg) { return asg.problems.reduce((n, p) => n + p.blanks.length, 0); }
  function filledBlanks(asg) {
    let n = 0;
    asg.problems.forEach((p) => p.blanks.forEach((_, bi) => { if (normalize(asg.answers[p.id + "_" + bi]) !== "") n++; }));
    return n;
  }

  /* ---------- 렌더 진입점 ---------- */
  const app = () => document.getElementById("app");

  function render() {
    if (mode === "student") ensureTodayAssignment();
    app().innerHTML = renderHeader() + `<main class="main">${mode === "student" ? renderStudent() : renderParent()}</main>`;
    bind();
  }

  function renderHeader() {
    if (mode === "student") {
      return `
      <header class="topbar">
        <div class="brand">일일수학</div>
        <button class="lock-btn" data-act="to-parent" aria-label="부모님 모드">🔒 부모님</button>
      </header>`;
    }
    const tabs = [["assign", "출제하기"], ["schedule", "스케줄"], ["answers", "정답확인"], ["history", "제출기록"], ["achievement", "성취도"], ["settings", "설정"]];
    return `
      <header class="topbar parent">
        <div class="brand">일일수학 <span class="brand-sub">부모님</span></div>
        <nav class="ptabs">
          ${tabs.map(([k, label]) => `<button class="ptab ${parentTab === k ? "active" : ""}" data-tab="${k}">${label}</button>`).join("")}
          <button class="ptab exit" data-act="to-student">학생 모드</button>
        </nav>
      </header>`;
  }

  /* ---------- 학생 모드 ---------- */
  function renderStudent() {
    const asg = state.assignment;
    if (!asg) {
      return `<div class="page-title"><h1>오늘의 문제</h1></div>
        <div class="empty">오늘은 아직 출제된 문제가 없어요.<br>부모님께 문제를 내달라고 해보세요!</div>`;
    }
    const submitted = asg.status === "submitted";
    const hasWrong = submitted && asg.result && asg.result.wrong.length > 0;
    const banner = submitted && asg.result
      ? `<div class="result-banner ${asg.result.wrong.length === 0 ? "ok" : "bad"}">
           채점 결과: ${asg.result.total}문제 중 <b>${asg.result.score}개</b> 정답
           ${asg.result.wrong.length ? `· 틀린 문제: ${asg.result.wrong.join(", ")}번 (빨간 문제를 다시 풀어요)` : "· 모두 정답!"}
         </div>` : "";
    return `
      <div class="page-title"><h1>오늘의 문제</h1></div>
      ${banner}
      ${renderWorksheet(asg, { interactive: !submitted, showAnswers: false, result: submitted ? asg.result : null })}
      ${hasWrong ? `<div class="action-row"><button class="btn btn-primary" data-act="redo">틀린 문제 다시 풀기</button></div>` : ""}`;
  }

  /* ---------- 부모님 모드 ---------- */
  function renderParent() {
    if (!parentUnlocked) return "";
    if (parentTab === "assign") return renderAssign();
    if (parentTab === "schedule") return renderSchedule();
    if (parentTab === "answers") return renderAnswers();
    if (parentTab === "history") return renderHistory();
    if (parentTab === "achievement") return renderAchievement();
    if (parentTab === "settings") return renderSettings();
    return "";
  }

  // 학년군/세부항목 선택 UI 공용 빌더
  function selectorHtml(prefix, sel) {
    const groups = activeGroups();
    const group = Curriculum.findGroup(sel.groupId) || groups[0];
    const items = group.items;
    const item = items.find((it) => it.id === sel.itemId) || items[0];
    return `
      <div class="field">
        <label>학년군</label>
        <select data-sel="${prefix}-group">
          ${groups.map((g) => `<option value="${g.id}" ${g.id === group.id ? "selected" : ""}>${g.label}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>세부 항목</label>
        <select data-sel="${prefix}-item">
          ${items.map((it) => `<option value="${it.id}" ${it.id === item.id ? "selected" : ""}>${escapeHtml(it.hint)} · ${escapeHtml(it.name)}</option>`).join("")}
        </select>
      </div>`;
  }

  function activeGroups() { return Curriculum.GROUPS.filter((g) => g.items.length); }

  let assignSel = { groupId: "g34", itemId: null, count: 10 };
  function renderAssign() {
    syncSel(assignSel);
    const cur = state.assignment;
    return `
      <div class="panel">
        <h2>문제 출제</h2>
        <p class="muted">학년군과 세부 항목, 문제 개수를 선택해 지금 바로 학생에게 출제합니다.</p>
        <div class="form-grid">
          ${selectorHtml("assign", assignSel)}
          <div class="field">
            <label>문제 개수</label>
            <input type="number" min="2" max="40" data-sel="assign-count" value="${assignSel.count}">
          </div>
        </div>
        <div class="action-row">
          <button class="btn btn-ghost" data-act="del-assign" ${cur ? "" : "disabled"}>출제 문제 삭제</button>
          <button class="btn btn-primary" data-act="do-assign">학생에게 출제하기</button>
        </div>
        ${cur ? `<div class="note">현재 출제됨: <b>${cur.meta.groupLabel} · ${escapeHtml(cur.meta.name)}</b> (${cur.problems.length}문제, ${fmtDate(cur.date)})
          ${cur.status === "submitted" && cur.result ? ` · 결과 ${cur.result.score}/${cur.result.total}` : " · 풀이 대기중"}</div>` : ""}
      </div>`;
  }

  // 선택 객체 정합성 보정 (학년군 바뀌면 itemId 갱신)
  function syncSel(sel) {
    const groups = activeGroups();
    let group = Curriculum.findGroup(sel.groupId);
    if (!group || !group.items.length) group = groups[0];
    sel.groupId = group.id;
    if (!group.items.find((it) => it.id === sel.itemId)) sel.itemId = group.items[0].id;
  }

  function renderSchedule() {
    const rows = [];
    const base = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      const ds = dateKey(d), wd = weekdayOf(ds);
      const override = state.scheduleOverrides[ds];
      const recurring = state.schedule[wd];
      const eff = override || recurring;
      const metaTxt = eff && eff.itemId ? (() => { const m = Curriculum.itemMeta(eff.itemId); return m ? `${m.groupLabel} · ${escapeHtml(m.name)} (${eff.count}문제)` : "없음"; })() : "없음";
      rows.push(`
        <div class="sch-row">
          <div class="sch-date">${fmtDate(ds)}${i === 0 ? ' <span class="badge">오늘</span>' : ""}${override ? ' <span class="badge alt">개별</span>' : ""}</div>
          <div class="sch-meta">${metaTxt}</div>
          <button class="btn btn-ghost sm" data-act="edit-sch" data-date="${ds}">편집</button>
        </div>`);
    }
    return `
      <div class="panel">
        <h2>주간 스케줄</h2>
        <p class="muted">요일별로 반복 출제할 문제를 설정합니다. 편집 시 "이 날짜만" 또는 "반복 등록"(같은 요일 모두)을 선택할 수 있어요.</p>
        <div class="sch-list">${rows.join("")}</div>
      </div>`;
  }

  function renderAnswers() {
    const asg = state.assignment;
    if (!asg) return `<div class="panel"><h2>정답 확인</h2><p class="muted">출제된 문제가 없습니다.</p></div>`;
    const resultTxt = asg.status === "submitted" && asg.result
      ? `<div class="result-banner ${asg.result.wrong.length === 0 ? "ok" : "bad"}">학생 결과: ${asg.result.total}문제 중 <b>${asg.result.score}개</b> 정답 ${asg.result.wrong.length ? `· 틀린 문제 ${asg.result.wrong.join(", ")}번` : "· 모두 정답!"}</div>`
      : `<div class="note">아직 학생이 제출하지 않았어요.</div>`;
    return `
      <div class="panel">
        <h2>정답 확인</h2>
        <p class="muted">현재 학생에게 출제된 문제(${asg.meta.groupLabel} · ${escapeHtml(asg.meta.name)})의 정답지입니다.</p>
        ${resultTxt}
        ${renderWorksheet(asg, { interactive: false, showAnswers: true, result: asg.status === "submitted" ? asg.result : null })}
      </div>`;
  }

  function renderHistory() {
    const hist = state.history || [];
    if (!hist.length) {
      return `<div class="panel"><h2>제출 기록</h2><p class="muted">아직 학생의 제출 기록이 없습니다.</p></div>`;
    }
    const rows = hist.map((r) => {
      const perfect = r.wrong.length === 0;
      const name = r.name || r.level || "";
      return `
        <div class="hist-row ${perfect ? "ok" : "bad"}">
          <div class="hist-time">${fmtDateTime(r.at)}</div>
          <div class="hist-sub">${r.groupLabel || ""} · ${escapeHtml(name)}</div>
          <div class="hist-score">${r.score}<span>/${r.total}</span></div>
          <div class="hist-wrong">${perfect ? "🎉 만점" : "틀린 문제 " + r.wrong.join(", ") + "번"}</div>
        </div>`;
    }).join("");
    return `
      <div class="panel">
        <h2>제출 기록</h2>
        <p class="muted">학생이 제출한 이력입니다. (제출 시간 · 점수 · 틀린 문제 번호)</p>
        <div class="hist-list">${rows}</div>
      </div>`;
  }

  /* ---------- 성취도 대시보드 ---------- */
  let achTab = "day";       // 'day' | 'month'
  let achDate = null;       // YYYY-MM-DD
  let achMonth = null;      // YYYY-MM

  function recDate(r) { return dateKey(new Date(r.at)); }
  function aggregate(recs) {
    let total = 0, correct = 0;
    recs.forEach((r) => { total += r.total || 0; correct += r.score || 0; });
    return { subs: recs.length, total, correct, acc: total ? Math.round((correct / total) * 100) : 0 };
  }
  function summaryHtml(agg) {
    const cards = [["제출 횟수", agg.subs + "회"], ["푼 문제", agg.total + "개"], ["맞은 문제", agg.correct + "개"], ["정답률", agg.acc + "%"]];
    return `<div class="ach-cards">${cards.map(([k, v]) => `<div class="ach-card"><div class="ach-card-v">${v}</div><div class="ach-card-k">${k}</div></div>`).join("")}</div>`;
  }
  function recListHtml(recs) {
    const rows = recs.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).map((r) => {
      const acc = r.total ? Math.round((r.score / r.total) * 100) : 0;
      return `<div class="ach-rec">
        <span class="ach-rec-t">${fmtTime(r.at)}</span>
        <span class="ach-rec-n">${escapeHtml(r.name || r.level || "")}</span>
        <span class="ach-rec-s">${r.score}/${r.total}</span>
        <span class="ach-bar"><span class="ach-bar-fill ${acc === 100 ? "full" : ""}" style="width:${acc}%"></span></span>
        <span class="ach-rec-p">${acc}%</span>
      </div>`;
    }).join("");
    return `<div class="ach-recs">${rows}</div>`;
  }

  function renderAchievement() {
    const hist = state.history || [];
    if (!achDate) achDate = today();
    if (!achMonth) achMonth = today().slice(0, 7);
    const tabs = `
      <div class="ach-tabs">
        <button class="ach-tab ${achTab === "day" ? "active" : ""}" data-ach="day">일 단위</button>
        <button class="ach-tab ${achTab === "month" ? "active" : ""}" data-ach="month">월 단위</button>
      </div>`;
    const body = achTab === "day" ? renderAchDay(hist) : renderAchMonth(hist);
    return `
      <div class="panel">
        <h2>학습 성취도</h2>
        <p class="muted">학생의 제출 기록을 기간별로 집계해 정답률과 학습량을 보여줍니다.</p>
        ${tabs}
        ${body}
      </div>`;
  }

  function renderAchDay(hist) {
    const recs = hist.filter((r) => recDate(r) === achDate);
    return `
      <div class="ach-controls">
        <label>날짜 선택</label>
        <input type="date" data-sel="ach-date" value="${achDate}">
      </div>
      ${summaryHtml(aggregate(recs))}
      ${recs.length ? recListHtml(recs) : `<div class="note">선택한 날짜에 제출 기록이 없습니다.</div>`}`;
  }

  function renderAchMonth(hist) {
    const recs = hist.filter((r) => recDate(r).slice(0, 7) === achMonth);
    const byDay = {};
    recs.forEach((r) => { const d = recDate(r); (byDay[d] = byDay[d] || []).push(r); });
    const days = Object.keys(byDay).sort();
    const bars = days.map((d) => {
      const a = aggregate(byDay[d]);
      return `<div class="ach-bar-row">
        <span class="ach-bar-day">${+d.slice(8, 10)}일</span>
        <span class="ach-bar"><span class="ach-bar-fill ${a.acc === 100 ? "full" : ""}" style="width:${a.acc}%"></span></span>
        <span class="ach-bar-val">${a.acc}% <em>(${a.correct}/${a.total})</em></span>
      </div>`;
    }).join("");
    return `
      <div class="ach-controls">
        <label>월 선택</label>
        <input type="month" data-sel="ach-month" value="${achMonth}">
      </div>
      ${summaryHtml(aggregate(recs))}
      ${days.length ? `<div class="ach-bars">${bars}</div>` : `<div class="note">선택한 달에 제출 기록이 없습니다.</div>`}`;
  }

  function renderSettings() {
    return `
      <div class="panel">
        <h2>설정</h2>
        <h3>비밀번호 변경</h3>
        <div class="form-grid narrow">
          <div class="field"><label>현재 비밀번호</label><input type="password" data-sel="pw-cur"></div>
          <div class="field"><label>새 비밀번호</label><input type="password" data-sel="pw-new"></div>
          <div class="field"><label>새 비밀번호 확인</label><input type="password" data-sel="pw-new2"></div>
        </div>
        <div class="action-row"><button class="btn btn-primary" data-act="change-pw">비밀번호 변경</button></div>
        <p class="muted small">초기 비밀번호는 기본값으로 설정되어 있습니다.</p>
      </div>`;
  }

  /* ---------- 문제지(worksheet) 렌더 ---------- */
  function renderWorksheet(asg, opts) {
    const m = asg.meta;
    const locked = asg.locked || [];
    const cells = asg.problems.map((p) => {
      const isLocked = locked.includes(p.id);
      const isWrong = opts.result && opts.result.wrong.includes(p.id);
      let html = p.promptHtml;
      html = html.replace(/<span class="blank" data-bi="(\d+)"[^>]*><\/span>/g, (mt, bi) => {
        bi = +bi;
        const key = p.id + "_" + bi;
        if (opts.showAnswers) {
          return `<span class="blank answer">${escapeHtml(p.blanks[bi])}</span>`;
        }
        const val = asg.answers[key];
        const shown = val != null && val !== "" ? escapeHtml(val) : "";
        if (isLocked) {
          return `<span class="blank correct">${shown}</span>`;
        }
        if (opts.result) {
          return `<span class="blank wrong"><span class="bad-val">${shown || "·"}</span></span>`;
        }
        const cls = "blank" + (shown ? " filled" : "");
        const attrs = opts.interactive ? ` data-blank="${key}" tabindex="0" role="button"` : "";
        return `<span class="${cls}"${attrs}>${shown}</span>`;
      });
      const pcls = "prob" + (isLocked ? " prob-correct" : isWrong ? " prob-wrong" : "");
      return `<div class="${pcls}"><span class="prob-no">${p.id}</span><div class="prob-body">${html}</div></div>`;
    }).join("");
    return `
      <div class="worksheet">
        <div class="ws-head">
          <div class="ws-logo">일일수학</div>
          <div class="ws-info"><div>${m.groupLabel}</div><div class="ws-unit">${escapeHtml(m.name)}</div><div class="ws-lvl">${escapeHtml(m.hint || "")}</div></div>
        </div>
        <h4 class="ws-title">${escapeHtml(m.title)}</h4>
        <div class="ws-grid">${cells}</div>
      </div>`;
  }

  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* ---------- 이벤트 바인딩 ---------- */
  function bind() {
    const root = app();

    root.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener("click", () => handleAct(el.getAttribute("data-act"), el));
    });
    root.querySelectorAll("[data-tab]").forEach((el) => {
      el.addEventListener("click", () => { parentTab = el.getAttribute("data-tab"); render(); });
    });

    // 출제 셀렉터 변경
    root.querySelectorAll('[data-sel^="assign-"]').forEach((el) => {
      el.addEventListener("change", () => {
        const k = el.getAttribute("data-sel");
        if (k === "assign-group") { assignSel.groupId = el.value; assignSel.itemId = null; syncSel(assignSel); render(); }
        else if (k === "assign-item") { assignSel.itemId = el.value; }
        else if (k === "assign-count") { assignSel.count = clampInt(el.value, 2, 40, 10); }
      });
    });

    // 성취도 컨트롤
    root.querySelectorAll("[data-ach]").forEach((el) => {
      el.addEventListener("click", () => { achTab = el.getAttribute("data-ach"); render(); });
    });
    root.querySelectorAll('[data-sel="ach-date"]').forEach((el) => {
      el.addEventListener("change", () => { achDate = el.value || today(); render(); });
    });
    root.querySelectorAll('[data-sel="ach-month"]').forEach((el) => {
      el.addEventListener("change", () => { achMonth = el.value || today().slice(0, 7); render(); });
    });

    // 학생 빈칸 클릭 → numberpad
    root.querySelectorAll("[data-blank]").forEach((el) => {
      const open = () => openBlank(el.getAttribute("data-blank"));
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  }

  function clampInt(v, min, max, dflt) { v = parseInt(v, 10); if (isNaN(v)) return dflt; return Math.max(min, Math.min(max, v)); }

  function handleAct(act, el) {
    switch (act) {
      case "to-parent": return promptParent();
      case "to-student": mode = "student"; render(); break;
      case "do-assign": return doAssign();
      case "del-assign": return doDeleteAssign();
      case "redo": return doRedo();
      case "change-pw": return doChangePw();
      case "edit-sch": return editSchedule(el.getAttribute("data-date"));
    }
  }

  /* ---------- 부모 진입(비밀번호) ---------- */
  function promptParent() {
    if (parentUnlocked) { mode = "parent"; render(); return; }
    Modal.show({
      title: "부모님 모드",
      bodyHtml: `<div class="field"><label>비밀번호</label><input type="password" id="m-pw" autofocus></div><div class="modal-err" id="m-pw-err"></div>`,
      buttons: [
        { label: "취소", kind: "ghost", onClick: () => Modal.close() },
        {
          label: "입장", kind: "primary", keepOpen: true, onClick: () => {
            const v = document.getElementById("m-pw").value;
            if (v === state.password) { parentUnlocked = true; mode = "parent"; Modal.close(); render(); }
            else document.getElementById("m-pw-err").textContent = "비밀번호가 올바르지 않습니다.";
          }
        },
      ],
    });
    setTimeout(() => { const i = document.getElementById("m-pw"); if (i) i.focus(); }, 50);
  }

  /* ---------- 출제 실행 ---------- */
  function doAssign() {
    syncSel(assignSel);
    const a = buildAssignment({ itemId: assignSel.itemId, count: assignSel.count }, today());
    if (!a) { Modal.alert("오류", "문제를 생성하지 못했습니다."); return; }
    state.assignment = a;
    saveState();
    Modal.alert("출제 완료", `${a.meta.groupLabel} · ${a.meta.name} ${a.problems.length}문제를 학생에게 출제했어요.`, () => render());
  }

  function doDeleteAssign() {
    if (!state.assignment) return;
    Modal.show({
      title: "출제 문제 삭제",
      bodyHtml: `<p class="modal-text">현재 출제된 문제를 삭제할까요?<br>학생 화면에서도 사라집니다.</p>`,
      buttons: [
        { label: "취소", kind: "ghost", onClick: () => Modal.close() },
        { label: "삭제", kind: "primary", onClick: () => { state.assignment = null; saveState(); Modal.close(); render(); } },
      ],
    });
  }

  /* ---------- 학생: 빈칸 입력 (numberpad) ---------- */
  function openBlank(key) {
    const asg = state.assignment;
    if (!asg) return;
    const root = app();
    root.querySelectorAll(".blank.active").forEach((b) => b.classList.remove("active"));
    const cell = root.querySelector(`[data-blank="${key}"]`);
    if (cell) cell.classList.add("active");
    const pid = +key.slice(0, key.lastIndexOf("_"));
    Numberpad.open({
      title: `${pid}번 문제 답 입력`,
      value: asg.answers[key] || "",
      onInput: (val) => {
        asg.answers[key] = val;
        const c = app().querySelector(`[data-blank="${key}"]`);
        if (c) { c.textContent = val; c.classList.toggle("filled", !!val); }
        saveState();
      },
      onClose: () => { render(); afterFill(); },
    });
  }

  function afterFill() {
    const asg = state.assignment;
    if (!asg || asg.status === "submitted") return;
    if (filledBlanks(asg) >= totalBlanks(asg)) {
      Modal.show({
        title: "다 풀었어요!",
        bodyHtml: `<p class="modal-text">답을 모두 입력했어요. 제출할까요?</p>`,
        buttons: [
          { label: "다시 풀기", kind: "ghost", onClick: () => Modal.close() },
          { label: "제출하기", kind: "primary", onClick: () => { Modal.close(); doSubmit(); } },
        ],
      });
    }
  }

  function doSubmit() {
    const asg = state.assignment;
    const result = grade(asg);
    asg.status = "submitted";
    asg.result = result;
    if (!Array.isArray(asg.locked)) asg.locked = [];
    asg.problems.forEach((p) => {
      if (!result.wrong.includes(p.id) && !asg.locked.includes(p.id)) asg.locked.push(p.id);
    });
    if (!Array.isArray(state.history)) state.history = [];
    state.history.unshift({
      at: new Date().toISOString(),
      itemId: asg.itemId,
      groupLabel: asg.meta.groupLabel,
      name: asg.meta.name,
      score: result.score,
      total: result.total,
      wrong: result.wrong.slice(),
    });
    if (state.history.length > 500) state.history = state.history.slice(0, 500);
    saveState();
    render();
    if (result.wrong.length === 0) {
      Modal.alert("🎉 만점!", "수고했어요. 엄마에게 자랑해요!");
    } else {
      Modal.alert("채점 완료", `${result.total}문제 중 ${result.score}개 맞았어요.\n틀린 문제: ${result.wrong.join(", ")}번\n빨간색으로 표시된 문제를 다시 풀어볼까요?`);
    }
  }

  // 다시 풀기: 정답으로 고정된 문제는 그대로 두고, 틀린/미입력 문제의 답만 초기화
  function doRedo() {
    const asg = state.assignment;
    if (!asg) return;
    const locked = asg.locked || [];
    asg.problems.forEach((p) => {
      if (locked.includes(p.id)) return;
      p.blanks.forEach((_, bi) => { delete asg.answers[p.id + "_" + bi]; });
    });
    asg.status = "pending";
    asg.result = null;
    saveState();
    render();
  }

  /* ---------- 비밀번호 변경 ---------- */
  function doChangePw() {
    const cur = document.querySelector('[data-sel="pw-cur"]').value;
    const n1 = document.querySelector('[data-sel="pw-new"]').value;
    const n2 = document.querySelector('[data-sel="pw-new2"]').value;
    if (cur !== state.password) return Modal.alert("변경 실패", "현재 비밀번호가 올바르지 않습니다.");
    if (!n1 || n1.length < 4) return Modal.alert("변경 실패", "새 비밀번호는 4자 이상이어야 합니다.");
    if (n1 !== n2) return Modal.alert("변경 실패", "새 비밀번호가 일치하지 않습니다.");
    state.password = n1;
    saveState();
    Modal.alert("완료", "비밀번호가 변경되었습니다.", () => render());
  }

  /* ---------- 스케줄 편집 ---------- */
  let schSel = {};
  function editSchedule(ds) {
    const wd = weekdayOf(ds);
    const eff = state.scheduleOverrides[ds] || state.schedule[wd] || {};
    schSel = { groupId: "g34", itemId: eff.itemId || null, count: eff.count || 10 };
    if (eff.itemId) { const f = Curriculum.findItem(eff.itemId); if (f) schSel.groupId = f.group.id; }
    syncSel(schSel);
    Modal.show({
      title: `${fmtDate(ds)} 스케줄 편집`,
      bodyHtml: `
        <div class="form-grid">${selectorHtml("sch", schSel)}
          <div class="field"><label>문제 개수</label><input type="number" min="2" max="40" data-sel="sch-count" value="${schSel.count}"></div>
        </div>
        <p class="muted small">변경 범위를 선택하세요.</p>`,
      buttons: [
        { label: "비우기", kind: "ghost", onClick: () => { delete state.scheduleOverrides[ds]; delete state.schedule[wd]; saveState(); Modal.close(); render(); } },
        { label: "이 날짜만", kind: "ghost", onClick: () => { state.scheduleOverrides[ds] = { itemId: schSel.itemId, count: schSel.count }; saveState(); Modal.close(); render(); } },
        { label: "반복 등록", kind: "primary", onClick: () => { state.schedule[wd] = { itemId: schSel.itemId, count: schSel.count }; delete state.scheduleOverrides[ds]; saveState(); Modal.close(); render(); } },
      ],
    });
    setTimeout(() => bindSchSelectors(), 30);
  }

  function bindSchSelectors() {
    document.querySelectorAll('[data-sel^="sch-"]').forEach((el) => {
      el.addEventListener("change", () => {
        const k = el.getAttribute("data-sel");
        if (k === "sch-group") { schSel.groupId = el.value; schSel.itemId = null; }
        else if (k === "sch-item") { schSel.itemId = el.value; return; }
        else if (k === "sch-count") { schSel.count = clampInt(el.value, 2, 40, 10); return; }
        syncSel(schSel);
        const wrap = el.closest(".form-grid");
        const countVal = wrap.querySelector('[data-sel="sch-count"]').value;
        wrap.innerHTML = selectorHtml("sch", schSel) + `<div class="field"><label>문제 개수</label><input type="number" min="2" max="40" data-sel="sch-count" value="${countVal}"></div>`;
        bindSchSelectors();
      });
    });
  }

  /* ---------- 모달 시스템 ---------- */
  const Modal = (function () {
    let el;
    function ensure() {
      if (el) return;
      el = document.createElement("div");
      el.className = "modal-overlay";
      el.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-title"></div><div class="modal-body"></div><div class="modal-buttons"></div></div>`;
      document.body.appendChild(el);
      el.addEventListener("click", (e) => { if (e.target === el && el._dismissable) close(); });
    }
    function show(opts) {
      ensure();
      el._dismissable = opts.dismissable !== false;
      el.querySelector(".modal-title").textContent = opts.title || "";
      el.querySelector(".modal-body").innerHTML = opts.bodyHtml || "";
      const bc = el.querySelector(".modal-buttons");
      bc.innerHTML = "";
      (opts.buttons || []).forEach((b) => {
        const btn = document.createElement("button");
        btn.className = "btn " + (b.kind === "primary" ? "btn-primary" : "btn-ghost");
        btn.textContent = b.label;
        btn.addEventListener("click", () => { b.onClick && b.onClick(); });
        bc.appendChild(btn);
      });
      el.classList.add("show");
      document.body.classList.add("no-scroll");
    }
    function close() { if (el) { el.classList.remove("show"); document.body.classList.remove("no-scroll"); } }
    function alert(title, text, onClose) {
      show({
        title,
        bodyHtml: `<p class="modal-text">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`,
        buttons: [{ label: "확인", kind: "primary", onClick: () => { close(); onClose && onClose(); } }],
      });
    }
    return { show, close, alert };
  })();

  /* ---------- 시작 ---------- */
  (async function init() {
    state = await loadState();
    render();
    // 다른 브라우저의 변경을 반영
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshFromServer(); });
    window.addEventListener("focus", () => refreshFromServer());
  })();
})();
