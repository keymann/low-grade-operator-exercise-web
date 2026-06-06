/*
 * app.js — 일일수학 클론 메인 앱
 *  - 학생 모드 / 부모님 모드(비밀번호)
 *  - 출제, 스케줄, 정답확인, 제출기록, 성취도, 설정
 *  - numberpad 답 입력, 채점
 *  - 상태는 Cloudflare KV(/api/state)에 저장되어 여러 브라우저에서 공유된다.
 */
(function () {
  "use strict";

  const STORE_PREFIX = "ilmath_state_v2:"; // 회원별 로컬 캐시 키 접두사
  const AUTH_KEY = "ilmath_auth";          // 로그인 캐시 { id, token }
  const INVITE_HINT = "hellow~!!!";        // 초대 코드(최종 검증은 서버)
  const ID_RE = /^[가-힣a-zA-Z0-9]{1,10}$/;
  const DEFAULT_PW = "kw20021163";
  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const WEEKDAY_KO = { sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토" };
  // 터치 환경(모바일/태블릿) 여부 — true면 OS 기본 숫자 키보드(네이티브 input), false면 커스텀 numberpad.
  // ?input=native / ?input=pad 로 강제 가능(QA용).
  const IS_TOUCH =
    /[?&]input=native/.test(location.search) ? true :
    /[?&]input=pad/.test(location.search) ? false :
    ((window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 0);

  /* ---------- 상태 ---------- */
  let auth = loadAuth();         // { id, token } | null  (로그인 정보 캐시)
  let authed = false;            // 로그인 완료 여부
  let authView = "login";        // 'login' | 'signup'
  let state = defaultState();
  let mode = "student";          // 'student' | 'parent'
  let parentUnlocked = false;    // 세션 동안만 유효
  let parentTab = "assign";      // 'assign' | 'schedule' | 'answers' | 'history' | 'achievement' | 'settings'
  let settingsTab = "parent";    // 'parent' | 'login' (설정 내부 탭)
  let dirty = false;             // 로컬 변경이 서버에 아직 반영되지 않음
  let saveTimer = null;

  /* ---------- 인증 캐시 ---------- */
  function loadAuth() { try { const r = localStorage.getItem(AUTH_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function saveAuth(a) { auth = a; try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) {} }
  function clearAuth() { auth = null; try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }
  function authQuery() { return auth ? `?u=${encodeURIComponent(auth.id)}&t=${encodeURIComponent(auth.token)}` : ""; }
  function cacheKey() { return STORE_PREFIX + (auth ? auth.id : "_"); }

  function defaultState() { return normalizeState({}); }
  function normalizeState(s) {
    s = s || {};
    return {
      password: s.password || DEFAULT_PW,
      schedules: Array.isArray(s.schedules) ? s.schedules : [], // 기간형 스케줄 [{id,start,end,itemId,count}]
      assignment: s.assignment || null,
      issued: Array.isArray(s.issued) ? s.issued : [],
      history: Array.isArray(s.history) ? s.history : [],
    };
  }

  // 서버(KV)에서 회원 상태 로드. 401(인증 실패) 이면 null 반환, 그 외 실패 시 캐시 폴백.
  async function loadState() {
    try {
      const res = await fetch("/api/state" + authQuery(), { cache: "no-store" });
      if (res.status === 401) return null;
      if (res.ok) {
        const j = await res.json();
        if (j && typeof j === "object") { cacheLocal(j); return normalizeState(j); }
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem(cacheKey());
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) {}
    return defaultState();
  }

  function cacheLocal(obj) { try { localStorage.setItem(cacheKey(), JSON.stringify(obj)); } catch (e) {} }

  // 로컬 즉시 저장 + 디바운스 서버 PUT
  function saveState() {
    cacheLocal(state);
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushState, 500);
  }
  function pushState() {
    if (!auth) return;
    const body = JSON.stringify(state);
    try {
      fetch("/api/state" + authQuery(), { method: "PUT", headers: { "Content-Type": "application/json" }, body })
        .then(() => { dirty = false; })
        .catch(() => {});
    } catch (e) {}
  }

  // 다른 브라우저의 변경을 반영(편집 중이 아닐 때만)
  async function refreshFromServer() {
    if (!auth || dirty || Numberpad.isOpen()) return;
    try {
      const res = await fetch("/api/state" + authQuery(), { cache: "no-store" });
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
  function addDays(dateStr, n) { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + n); return dateKey(d); }
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
  // specs: [{itemId, count}] — 여러 항목을 한 문제지로 합본(겹침 출제). 문제는 1..N 연속 재번호.
  function buildAssignment(specs, dateStr) {
    if (!Array.isArray(state.issued)) state.issued = [];
    const exclude = new Set(state.issued);
    const problems = [];
    const metas = [];
    specs.forEach((spec) => {
      const set = Curriculum.generateSet(spec.itemId, spec.count, exclude);
      const meta = Curriculum.itemMeta(spec.itemId);
      if (!set || !meta) return;
      metas.push(meta);
      set.forEach((p) => { exclude.add(p.promptHtml); state.issued.push(p.promptHtml); problems.push({ promptHtml: p.promptHtml, blanks: p.blanks }); });
    });
    if (!problems.length) return null;
    problems.forEach((p, i) => { p.id = i + 1; }); // 연속 넘버링
    if (state.issued.length > 2000) state.issued = state.issued.slice(-2000);
    const meta = {
      groupLabel: metas.length === 1 ? metas[0].groupLabel : metas.map((m) => m.groupLabel).filter((v, i, a) => a.indexOf(v) === i).join(" · "),
      name: metas.map((m) => m.name).join(" · "),
      title: metas.map((m) => m.title).join(" · "),
    };
    return { specs, meta, problems, date: dateStr, status: "pending", answers: {}, result: null, locked: [] };
  }

  // 오늘의 문제 보장: 당일 출제가 있으면 유지, 없으면 당일에 적용되는 스케줄 전부로 합본 생성
  function ensureTodayAssignment() {
    const t = today();
    if (state.assignment && state.assignment.date === t) return;
    const specs = (state.schedules || [])
      .filter((e) => e && e.itemId && e.start <= t && t <= e.end)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
      .map((e) => ({ itemId: e.itemId, count: e.count }));
    if (specs.length) {
      const a = buildAssignment(specs, t);
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
    // 미인증: 로그인/회원가입 화면만 노출
    if (!authed) {
      document.body.classList.remove("student-mode");
      app().innerHTML = renderAuth();
      bindAuth();
      return;
    }
    if (mode === "student") ensureTodayAssignment();
    // 학생 모드: 롱프레스로 인한 텍스트 선택(select mode)/콜아웃 비활성화
    document.body.classList.toggle("student-mode", mode === "student");
    app().innerHTML = renderHeader() + `<main class="main">${mode === "student" ? renderStudent() : renderParent()}</main>`;
    bind();
  }

  /* ---------- 로그인 / 회원가입 ---------- */
  function renderAuth() {
    return `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="brand auth-brand">일일수학</div>
          ${authView === "login" ? renderLogin() : renderSignup()}
        </div>
      </div>`;
  }
  function renderLogin() {
    return `
      <h2 class="auth-title">로그인</h2>
      <div class="field"><label>아이디</label><input type="text" id="login-id" autocomplete="username" maxlength="10"></div>
      <div class="field"><label>비밀번호</label><input type="password" id="login-pw" autocomplete="current-password"></div>
      <div class="auth-err" id="auth-err"></div>
      <button class="btn btn-primary auth-btn" data-auth="do-login">로그인</button>
      <div class="auth-switch">계정이 없나요? <a href="#" data-auth="to-signup">회원가입</a></div>`;
  }
  function renderSignup() {
    return `
      <h2 class="auth-title">회원가입</h2>
      <div class="field"><label>아이디 <span class="hint">(한글·영어·숫자, 10자 이내)</span></label><input type="text" id="su-id" maxlength="10"></div>
      <div class="field"><label>비밀번호</label><input type="password" id="su-pw"></div>
      <div class="field"><label>비밀번호 다시 입력</label><input type="password" id="su-pw2"></div>
      <div class="field"><label>초대 코드</label><input type="text" id="su-invite"></div>
      <div class="auth-err" id="auth-err"></div>
      <button class="btn btn-primary auth-btn" data-auth="do-signup">가입하기</button>
      <div class="auth-switch">이미 계정이 있나요? <a href="#" data-auth="to-login">로그인</a></div>`;
  }
  function authErr(msg) { const el = document.getElementById("auth-err"); if (el) el.textContent = msg || ""; }

  function bindAuth() {
    const root = app();
    root.querySelectorAll("[data-auth]").forEach((el) => {
      el.addEventListener("click", (e) => {
        const a = el.getAttribute("data-auth");
        if (a === "to-signup" || a === "to-login") { e.preventDefault(); authView = a === "to-signup" ? "signup" : "login"; render(); return; }
        if (a === "do-login") return doLogin();
        if (a === "do-signup") return doSignup();
      });
    });
    const submitOn = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fn(); } }); };
    if (authView === "login") { submitOn("login-id", doLogin); submitOn("login-pw", doLogin); }
    else { ["su-id", "su-pw", "su-pw2", "su-invite"].forEach((id) => submitOn(id, doSignup)); }
  }

  async function doLogin() {
    const id = (document.getElementById("login-id").value || "").trim();
    const pw = document.getElementById("login-pw").value || "";
    if (!id || !pw) { authErr("아이디 또는 비밀번호 확인해 주세요~"); return; }
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, password: pw }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { authErr("아이디 또는 비밀번호 확인해 주세요~"); return; }
      saveAuth({ id: j.id, token: j.token });
      await enterApp();
    } catch (e) { authErr("아이디 또는 비밀번호 확인해 주세요~"); }
  }

  async function doSignup() {
    const id = (document.getElementById("su-id").value || "").trim();
    const pw = document.getElementById("su-pw").value || "";
    const pw2 = document.getElementById("su-pw2").value || "";
    const invite = document.getElementById("su-invite").value || "";
    if (!ID_RE.test(id)) { authErr("아이디는 한글·영어·숫자 10자 이내로 입력해 주세요~"); return; }
    if (!pw || pw !== pw2) { authErr("비밀번호가 일치하지 않습니다~"); return; }
    if (invite !== INVITE_HINT) { authErr("초대 코드 다시 확인해 주세요~"); return; }
    try {
      const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, password: pw, password2: pw2, invite }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) { saveAuth({ id: j.id, token: j.token }); await enterApp(); return; }
      const map = {
        invite: "초대 코드 다시 확인해 주세요~",
        dup: "이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요~",
        id_format: "아이디는 한글·영어·숫자 10자 이내로 입력해 주세요~",
        pw_mismatch: "비밀번호가 일치하지 않습니다~",
      };
      authErr(map[j.error] || "가입에 실패했어요. 잠시 후 다시 시도해 주세요~");
    } catch (e) { authErr("가입에 실패했어요. 잠시 후 다시 시도해 주세요~"); }
  }

  // 인증 성공 후 상태 로드 → 학생 모드 진입
  async function enterApp() {
    const s = await loadState();
    if (s === null) { clearAuth(); authed = false; authView = "login"; render(); authErr("아이디 또는 비밀번호 확인해 주세요~"); return; }
    state = s;
    authed = true; mode = "student"; parentUnlocked = false; parentTab = "assign";
    render();
  }

  function doLogout() {
    try { localStorage.removeItem(cacheKey()); } catch (e) {}
    clearAuth();
    authed = false; parentUnlocked = false; mode = "student"; authView = "login";
    state = defaultState();
    render();
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
        <label>학년·학기</label>
        <select data-sel="${prefix}-group">
          ${groups.map((g) => `<option value="${g.id}" ${g.id === group.id ? "selected" : ""}>${g.label}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>세부 항목</label>
        <select data-sel="${prefix}-item">
          ${items.map((it) => `<option value="${it.id}" ${it.id === item.id ? "selected" : ""}>${escapeHtml(it.name)}</option>`).join("")}
        </select>
      </div>`;
  }

  function activeGroups() { return Curriculum.GROUPS.filter((g) => g.items.length); }

  let assignSel = { groupId: "g31", itemId: null, count: 10 };
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

  let schAddSel = { groupId: "g31", itemId: null, count: 10 };
  function renderSchedule() {
    syncSel(schAddSel);
    const t = today();
    const list = (state.schedules || []).slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const rows = list.length ? list.map((e) => {
      const m = Curriculum.itemMeta(e.itemId);
      const active = e.start <= t && t <= e.end;
      return `
        <div class="sch-row">
          <div class="sch-date">${fmtDate(e.start)} ~ ${fmtDate(e.end)}${active ? ' <span class="badge">진행중</span>' : ""}</div>
          <div class="sch-meta">${m ? `${m.groupLabel} · ${escapeHtml(m.name)} (${e.count}문제)` : "없음"}</div>
          <div class="sch-actions">
            <button class="btn btn-ghost sm" data-act="edit-sch" data-id="${e.id}">편집</button>
            <button class="btn btn-ghost sm danger" data-act="del-sch" data-id="${e.id}">삭제</button>
          </div>
        </div>`;
    }).join("") : `<div class="note">등록된 스케줄이 없습니다.</div>`;
    return `
      <div class="panel">
        <h2>스케줄</h2>
        <p class="muted">기간(시작~종료)을 정하고 학년·학기·세부 항목·문제 개수를 지정해 등록합니다. 같은 날 여러 스케줄이 겹치면 모든 문제가 함께 출제됩니다.</p>
        <div class="form-grid">
          <div class="field"><label>시작일</label><input type="date" data-sel="schadd-start" value="${t}"></div>
          <div class="field"><label>종료일</label><input type="date" data-sel="schadd-end" value="${t}"></div>
        </div>
        <div class="form-grid">
          ${selectorHtml("schadd", schAddSel)}
          <div class="field"><label>문제 개수</label><input type="number" min="2" max="40" data-sel="schadd-count" value="${schAddSel.count}"></div>
        </div>
        <div class="action-row"><button class="btn btn-primary" data-act="add-sch">스케줄 추가</button></div>
        <h3>등록된 스케줄</h3>
        <div class="sch-list">${rows}</div>
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
  // 같은 문제(내용 동일)는 1회만 집계. 정답 여부는 최근 시도 기준.
  // recs 는 최신순(newest-first)으로 들어온다고 가정 → 처음 본 해시 = 최근 시도.
  function aggregate(recs) {
    const seen = new Map();           // h → ok (최근 시도)
    let legacyTotal = 0, legacyCorrect = 0; // items 없는 구버전 레코드 폴백
    recs.forEach((r) => {
      if (Array.isArray(r.items)) {
        r.items.forEach((it) => { if (!seen.has(it.h)) seen.set(it.h, !!it.ok); });
      } else {
        legacyTotal += r.total || 0; legacyCorrect += r.score || 0;
      }
    });
    let correct = legacyCorrect;
    seen.forEach((ok) => { if (ok) correct++; });
    const total = seen.size + legacyTotal;
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
    const tabs = `
      <div class="ach-tabs">
        <button class="ach-tab ${settingsTab === "parent" ? "active" : ""}" data-stab="parent">부모모드 비밀번호</button>
        <button class="ach-tab ${settingsTab === "login" ? "active" : ""}" data-stab="login">로그인 비밀번호</button>
      </div>`;
    const body = settingsTab === "login" ? renderLoginPwForm() : renderParentPwForm();
    return `
      <div class="panel">
        <h2>설정</h2>
        ${tabs}
        ${body}
        <h3>계정</h3>
        <div class="note">현재 로그인: <b>${escapeHtml(auth ? auth.id : "")}</b></div>
        <div class="action-row"><button class="btn btn-ghost" data-act="logout">로그아웃</button></div>
      </div>`;
  }

  function renderParentPwForm() {
    return `
      <h3>부모모드 비밀번호 변경</h3>
      <div class="form-grid narrow">
        <div class="field"><label>현재 비밀번호</label><input type="password" data-sel="pw-cur"></div>
        <div class="field"><label>새 비밀번호</label><input type="password" data-sel="pw-new"></div>
        <div class="field"><label>새 비밀번호 확인</label><input type="password" data-sel="pw-new2"></div>
      </div>
      <div class="action-row"><button class="btn btn-primary" data-act="change-pw">부모모드 비밀번호 변경</button></div>
      <p class="muted small">부모모드 진입 시 사용하는 비밀번호입니다(로그인 비밀번호와 별개).</p>`;
  }

  function renderLoginPwForm() {
    return `
      <h3>로그인 비밀번호 변경</h3>
      <div class="form-grid narrow">
        <div class="field"><label>현재 로그인 비밀번호</label><input type="password" data-sel="lpw-cur"></div>
        <div class="field"><label>새 로그인 비밀번호</label><input type="password" data-sel="lpw-new"></div>
        <div class="field"><label>새 비밀번호 확인</label><input type="password" data-sel="lpw-new2"></div>
      </div>
      <div class="action-row"><button class="btn btn-primary" data-act="change-login-pw">로그인 비밀번호 변경</button></div>
      <p class="muted small">다음 로그인부터 새 비밀번호를 사용합니다(4자 이상).</p>`;
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
        // 정답 자릿수에 맞춰 답란 폭을 동적으로 결정(잘림 방지, 셀 초과 방지)
        const w = blankWidthCh(p.blanks[bi]);
        if (opts.showAnswers) {
          return `<span class="blank answer" style="min-width:${w}ch">${escapeHtml(p.blanks[bi])}</span>`;
        }
        const val = asg.answers[key];
        const shown = val != null && val !== "" ? escapeHtml(val) : "";
        if (isLocked) {
          return `<span class="blank correct" style="min-width:${w}ch">${shown}</span>`;
        }
        if (opts.result) {
          return `<span class="blank wrong" style="min-width:${w}ch"><span class="bad-val">${shown || "·"}</span></span>`;
        }
        const cls = "blank" + (shown ? " filled" : "");
        if (opts.interactive && IS_TOUCH) {
          // 모바일/태블릿: 네이티브 입력 → OS 기본 숫자 키보드
          return `<input class="${cls} blank-input" data-blank="${key}" inputmode="decimal" maxlength="9" aria-label="답 입력" style="width:calc(${w}ch + 1.3em)" value="${escapeHtml(shown)}">`;
        }
        const attrs = opts.interactive ? ` data-blank="${key}" tabindex="0" role="button"` : "";
        return `<span class="${cls}"${attrs} style="min-width:${w}ch">${shown}</span>`;
      });
      const pcls = "prob" + (isLocked ? " prob-correct" : isWrong ? " prob-wrong" : "");
      return `<div class="${pcls}"><span class="prob-no">${p.id}</span><div class="prob-body">${html}</div></div>`;
    }).join("");
    return `
      <div class="worksheet">
        <div class="ws-head">
          <div class="ws-logo">일일수학</div>
          <div class="ws-info"><div class="ws-unit">${m.groupLabel}</div><div class="ws-lvl">${escapeHtml(m.name)}</div></div>
        </div>
        <h4 class="ws-title">${escapeHtml(m.title)}</h4>
        <div class="ws-grid">${cells}</div>
      </div>`;
  }

  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // 문제 내용(promptHtml) 시그니처 해시(32-bit FNV-1a → base36). 성취도 중복 제외용.
  function sigHash(s) {
    s = String(s == null ? "" : s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(36);
  }

  // 정답 길이에 따른 답란 폭(ch). 잘림 방지(상한)·과소(하한) 모두 제한 → 셀 초과 방지는 grid/max-width가 담당.
  function blankWidthCh(ans) {
    const len = String(ans == null ? "" : ans).length;
    return Math.min(Math.max(len + 1, 3), 11);
  }

  /* ---------- 이벤트 바인딩 ---------- */
  function bind() {
    const root = app();

    root.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener("click", () => handleAct(el.getAttribute("data-act"), el));
    });
    root.querySelectorAll("[data-tab]").forEach((el) => {
      el.addEventListener("click", () => { parentTab = el.getAttribute("data-tab"); render(); });
    });
    root.querySelectorAll("[data-stab]").forEach((el) => {
      el.addEventListener("click", () => { settingsTab = el.getAttribute("data-stab"); render(); });
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

    if (IS_TOUCH) {
      // 모바일/태블릿: 네이티브 입력 → OS 숫자 키보드
      root.querySelectorAll("input[data-blank]").forEach((el) => {
        const key = el.getAttribute("data-blank");
        el.addEventListener("input", () => {
          let v = el.value.replace(/[^0-9.]/g, "");
          const dot = v.indexOf(".");
          if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
          if (v !== el.value) el.value = v;
          state.assignment.answers[key] = v;
          el.classList.toggle("filled", !!v);
          saveState();
        });
        el.addEventListener("focus", () => { setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 60); });
        el.addEventListener("blur", () => {
          saveState();
          // 다른 답란으로 이동한 게 아니면 제출 모달 검사
          setTimeout(() => {
            const ae = document.activeElement;
            if (!(ae && ae.matches && ae.matches("input[data-blank]"))) afterFill();
          }, 0);
        });
      });
    } else {
      // PC: 답란 클릭 → 커스텀 numberpad
      root.querySelectorAll("[data-blank]").forEach((el) => {
        const open = () => openBlank(el.getAttribute("data-blank"));
        el.addEventListener("click", open);
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      });
    }

    // 스케줄 등록 폼 셀렉터(있을 때만)
    if (root.querySelector('[data-sel^="schadd-"]')) bindSelGrid("schadd", schAddSel);
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
      case "change-login-pw": return doChangeLoginPw();
      case "add-sch": return doAddSchedule();
      case "edit-sch": return editSchedule(el.getAttribute("data-id"));
      case "del-sch": return doDeleteSchedule(el.getAttribute("data-id"));
      case "logout": return doLogout();
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
    const a = buildAssignment([{ itemId: assignSel.itemId, count: assignSel.count }], today());
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
      anchor: cell,
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
      groupLabel: asg.meta.groupLabel,
      name: asg.meta.name,
      score: result.score,
      total: result.total,
      wrong: result.wrong.slice(),
      // 성취도 중복 제외용: 문제 내용 해시 + 정답 여부
      items: asg.problems.map((p) => ({ h: sigHash(p.promptHtml), ok: !result.wrong.includes(p.id) })),
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

  // 로그인 비밀번호 변경 (서버 검증 → 새 토큰으로 캐시 갱신)
  async function doChangeLoginPw() {
    if (!auth) return;
    const cur = document.querySelector('[data-sel="lpw-cur"]').value;
    const n1 = document.querySelector('[data-sel="lpw-new"]').value;
    const n2 = document.querySelector('[data-sel="lpw-new2"]').value;
    if (!n1 || n1.length < 4) return Modal.alert("변경 실패", "새 비밀번호는 4자 이상이어야 합니다.");
    if (n1 !== n2) return Modal.alert("변경 실패", "새 비밀번호가 일치하지 않습니다.");
    try {
      const res = await fetch("/api/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: auth.id, current: cur, next: n1 }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) { saveAuth({ id: j.id, token: j.token }); Modal.alert("완료", "로그인 비밀번호가 변경되었습니다.", () => render()); return; }
      if (j.error === "auth") return Modal.alert("변경 실패", "현재 로그인 비밀번호가 올바르지 않습니다.");
      if (j.error === "weak") return Modal.alert("변경 실패", "새 비밀번호는 4자 이상이어야 합니다.");
      Modal.alert("변경 실패", "비밀번호를 변경하지 못했습니다.");
    } catch (e) { Modal.alert("변경 실패", "비밀번호를 변경하지 못했습니다."); }
  }

  /* ---------- 스케줄 (기간형) ---------- */
  let schSel = {};
  function schedId() { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // 학년·학기/세부항목 셀렉터(+개수) 그리드의 동적 갱신. prefix별 sel 객체 사용.
  function bindSelGrid(prefix, sel) {
    document.querySelectorAll(`[data-sel^="${prefix}-"]`).forEach((el) => {
      el.addEventListener("change", () => {
        const k = el.getAttribute("data-sel");
        if (k === `${prefix}-group`) { sel.groupId = el.value; sel.itemId = null; syncSel(sel); }
        else if (k === `${prefix}-item`) { sel.itemId = el.value; return; }
        else if (k === `${prefix}-count`) { sel.count = clampInt(el.value, 2, 40, 10); return; }
        else return; // 날짜 입력 등은 제출 시 읽음
        const grid = el.closest(".form-grid");
        const countEl = grid.querySelector(`[data-sel="${prefix}-count"]`);
        const countVal = countEl ? countEl.value : sel.count;
        grid.innerHTML = selectorHtml(prefix, sel) + `<div class="field"><label>문제 개수</label><input type="number" min="2" max="40" data-sel="${prefix}-count" value="${countVal}"></div>`;
        bindSelGrid(prefix, sel);
      });
    });
  }

  function doAddSchedule() {
    const start = document.querySelector('[data-sel="schadd-start"]').value;
    const end = document.querySelector('[data-sel="schadd-end"]').value;
    const count = clampInt(document.querySelector('[data-sel="schadd-count"]').value, 2, 40, 10);
    syncSel(schAddSel);
    if (!start || !end) return Modal.alert("등록 실패", "시작일과 종료일을 선택해 주세요.");
    if (start > end) return Modal.alert("등록 실패", "종료일은 시작일과 같거나 이후여야 합니다.");
    if (!schAddSel.itemId) return Modal.alert("등록 실패", "세부 항목을 선택해 주세요.");
    if (!Array.isArray(state.schedules)) state.schedules = [];
    state.schedules.push({ id: schedId(), start, end, itemId: schAddSel.itemId, count });
    saveState();
    Modal.alert("등록 완료", `${fmtDate(start)} ~ ${fmtDate(end)} 스케줄을 추가했어요.`, () => render());
  }

  function doDeleteSchedule(id) {
    const e = (state.schedules || []).find((x) => x.id === id);
    if (!e) return;
    const m = Curriculum.itemMeta(e.itemId);
    Modal.show({
      title: "스케줄 삭제",
      bodyHtml: `<p class="modal-text">${fmtDate(e.start)} ~ ${fmtDate(e.end)}<br>${m ? escapeHtml(m.name) : ""} 스케줄을 삭제할까요?</p>`,
      buttons: [
        { label: "취소", kind: "ghost", onClick: () => Modal.close() },
        { label: "삭제", kind: "primary", onClick: () => { state.schedules = state.schedules.filter((x) => x.id !== id); saveState(); Modal.close(); render(); } },
      ],
    });
  }

  function editSchedule(id) {
    const e = (state.schedules || []).find((x) => x.id === id);
    if (!e) return;
    schSel = { groupId: "g31", itemId: e.itemId, count: e.count };
    const f = Curriculum.findItem(e.itemId); if (f) schSel.groupId = f.group.id;
    syncSel(schSel);
    Modal.show({
      title: "스케줄 편집",
      bodyHtml: `
        <div class="form-grid">
          <div class="field"><label>시작일</label><input type="date" data-sel="schedit-start" value="${e.start}"></div>
          <div class="field"><label>종료일</label><input type="date" data-sel="schedit-end" value="${e.end}"></div>
        </div>
        <div class="form-grid">${selectorHtml("schedit", schSel)}
          <div class="field"><label>문제 개수</label><input type="number" min="2" max="40" data-sel="schedit-count" value="${schSel.count}"></div>
        </div>
        <p class="muted small">기간 일부만 바꾸려면 날짜를 그 범위로 좁힌 뒤 "선택 기간만 변경"을 누르세요.</p>`,
      buttons: [
        { label: "취소", kind: "ghost", onClick: () => Modal.close() },
        { label: "선택 기간만 변경", kind: "ghost", onClick: () => applyScheduleEdit(id, false) },
        { label: "전체 수정", kind: "primary", onClick: () => applyScheduleEdit(id, true) },
      ],
    });
    setTimeout(() => bindSelGrid("schedit", schSel), 30);
  }

  function applyScheduleEdit(id, whole) {
    const e = (state.schedules || []).find((x) => x.id === id);
    if (!e) return;
    const start = document.querySelector('[data-sel="schedit-start"]').value;
    const end = document.querySelector('[data-sel="schedit-end"]').value;
    const count = clampInt(document.querySelector('[data-sel="schedit-count"]').value, 2, 40, 10);
    syncSel(schSel);
    if (!start || !end || start > end) return Modal.alert("수정 실패", "기간을 올바르게 선택해 주세요.");
    if (!schSel.itemId) return Modal.alert("수정 실패", "세부 항목을 선택해 주세요.");
    if (whole) {
      e.start = start; e.end = end; e.itemId = schSel.itemId; e.count = count;
    } else {
      if (start < e.start || end > e.end) return Modal.alert("수정 실패", "선택 기간은 원래 기간 안에 있어야 합니다.");
      const pieces = [];
      if (e.start < start) pieces.push({ id: schedId(), start: e.start, end: addDays(start, -1), itemId: e.itemId, count: e.count });
      pieces.push({ id: schedId(), start, end, itemId: schSel.itemId, count });
      if (end < e.end) pieces.push({ id: schedId(), start: addDays(end, 1), end: e.end, itemId: e.itemId, count: e.count });
      state.schedules = state.schedules.filter((x) => x.id !== id).concat(pieces);
    }
    saveState(); Modal.close(); render();
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
    // 캐시된 로그인이 있으면 자동 로그인(해당 아이디의 학생 모드로 진입)
    if (auth && auth.id && auth.token) {
      const s = await loadState();
      if (s !== null) { state = s; authed = true; }
      else { clearAuth(); authed = false; }
    }
    render();
    // 다른 브라우저의 변경을 반영
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshFromServer(); });
    window.addEventListener("focus", () => refreshFromServer());
  })();
})();
