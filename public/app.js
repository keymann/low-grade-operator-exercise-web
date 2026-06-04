/*
 * app.js — 일일수학 클론 메인 앱
 *  - 학생 모드 / 부모님 모드(비밀번호)
 *  - 출제, 스케줄, 설정, 정답확인
 *  - 손글씨 + OCR 답 입력, 채점
 */
(function () {
  "use strict";

  const STORE_KEY = "ilmath_state_v1";
  const DEFAULT_PW = "kw20021163";
  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const WEEKDAY_KO = { sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토" };

  /* ---------- 상태 ---------- */
  let state = loadState();
  let mode = "student";          // 'student' | 'parent'
  let parentUnlocked = false;    // 세션 동안만 유효
  let parentTab = "assign";      // 'assign' | 'schedule' | 'answers' | 'settings'

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { password: DEFAULT_PW, schedule: {}, scheduleOverrides: {}, assignment: null, issued: [], history: [] };
  }
  function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

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

  /* ---------- 출제(assignment) 구성 ---------- */
  function buildAssignment(spec, dateStr) {
    if (!Array.isArray(state.issued)) state.issued = [];
    const exclude = new Set(state.issued);
    const problems = Curriculum.generateSet(spec.levelId, spec.count, exclude);
    const meta = Curriculum.levelMeta(spec.levelId);
    if (!problems || !meta) return null;
    // 이번에 출제한 문제 시그니처를 기록(이후 출제에서 중복 회피). 최근 1000개만 유지.
    problems.forEach((p) => state.issued.push(p.promptHtml));
    if (state.issued.length > 1000) state.issued = state.issued.slice(-1000);
    // locked: 채점에서 정답 처리되어 고정된 문제 id 목록 (다시 풀기 시 유지)
    return { levelId: spec.levelId, count: spec.count, meta, problems, date: dateStr, status: "pending", answers: {}, result: null, locked: [] };
  }

  // 오늘의 문제 보장: 명시적 당일 출제가 있으면 유지, 없으면 스케줄/오버라이드로 생성
  function ensureTodayAssignment() {
    const t = today();
    if (state.assignment && state.assignment.date === t) return;
    const spec = state.scheduleOverrides[t] || state.schedule[weekdayOf(t)];
    if (spec && spec.levelId) {
      const a = buildAssignment(spec, t);
      if (a) { state.assignment = a; saveState(); return; }
    }
    // 오늘 예정된 문제 없음 → 지난 출제는 비운다
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
    const tabs = [["assign", "출제하기"], ["schedule", "스케줄"], ["answers", "정답확인"], ["history", "제출기록"], ["settings", "설정"]];
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
    if (parentTab === "settings") return renderSettings();
    return "";
  }

  // 학년/단원/단계 선택 UI 공용 빌더
  function selectorHtml(prefix, sel) {
    const grades = Curriculum.GRADES;
    const grade = Curriculum.findGrade(sel.gradeId) || grades[0];
    const units = grade.units;
    const uIdx = Math.min(sel.unitIdx ?? 0, units.length - 1);
    const unit = units[uIdx];
    const levels = unit.levels;
    const level = levels.find((l) => l.id === sel.levelId) || levels[0];
    return `
      <div class="field">
        <label>학년</label>
        <select data-sel="${prefix}-grade">
          ${grades.map((g) => `<option value="${g.id}" ${g.id === grade.id ? "selected" : ""}>${g.label}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>단원</label>
        <select data-sel="${prefix}-unit">
          ${units.map((u, i) => `<option value="${i}" ${i === uIdx ? "selected" : ""}>${u.sem} ${u.name}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>세부 항목</label>
        <select data-sel="${prefix}-level">
          ${levels.map((l) => `<option value="${l.id}" ${l.id === level.id ? "selected" : ""}>${l.name}</option>`).join("")}
        </select>
      </div>`;
  }

  let assignSel = { gradeId: "1", unitIdx: 0, levelId: null, count: 10 };
  function renderAssign() {
    syncSel(assignSel);
    const cur = state.assignment;
    return `
      <div class="panel">
        <h2>문제 출제</h2>
        <p class="muted">학년과 세부 항목, 문제 개수를 선택해 지금 바로 학생에게 출제합니다.</p>
        <div class="form-grid">
          ${selectorHtml("assign", assignSel)}
          <div class="field">
            <label>문제 개수</label>
            <input type="number" min="2" max="40" data-sel="assign-count" value="${assignSel.count}">
          </div>
        </div>
        <div class="action-row">
          <button class="btn btn-primary" data-act="do-assign">학생에게 출제하기</button>
        </div>
        ${cur ? `<div class="note">현재 출제됨: <b>${cur.meta.gradeLabel} · ${cur.meta.level}</b> (${cur.problems.length}문제, ${fmtDate(cur.date)})
          ${cur.status === "submitted" && cur.result ? ` · 결과 ${cur.result.score}/${cur.result.total}` : " · 풀이 대기중"}</div>` : ""}
      </div>`;
  }

  // 선택 객체 정합성 보정 (학년/단원 바뀌면 levelId 갱신)
  function syncSel(sel) {
    const grade = Curriculum.findGrade(sel.gradeId) || Curriculum.GRADES[0];
    sel.gradeId = grade.id;
    if (sel.unitIdx == null || sel.unitIdx >= grade.units.length) sel.unitIdx = 0;
    const unit = grade.units[sel.unitIdx];
    if (!unit.levels.find((l) => l.id === sel.levelId)) sel.levelId = unit.levels[0].id;
  }

  function renderSchedule() {
    // 오늘부터 7일
    const rows = [];
    const base = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      const ds = dateKey(d), wd = weekdayOf(ds);
      const override = state.scheduleOverrides[ds];
      const recurring = state.schedule[wd];
      const eff = override || recurring;
      const metaTxt = eff && eff.levelId ? (() => { const m = Curriculum.levelMeta(eff.levelId); return m ? `${m.gradeLabel} · ${m.level} (${eff.count}문제)` : "없음"; })() : "없음";
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
        <p class="muted">요일별로 반복 출제할 문제를 설정합니다. 편집 시 "이 날짜만" 또는 "같은 요일 모두"를 선택할 수 있어요.</p>
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
        <p class="muted">현재 학생에게 출제된 문제(${asg.meta.gradeLabel} · ${asg.meta.level})의 정답지입니다.</p>
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
      return `
        <div class="hist-row ${perfect ? "ok" : "bad"}">
          <div class="hist-time">${fmtDateTime(r.at)}</div>
          <div class="hist-sub">${r.gradeLabel} · ${escapeHtml(r.level)}</div>
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
      const isLocked = locked.includes(p.id);            // 정답 확정 → 고정/유지
      const isWrong = opts.result && opts.result.wrong.includes(p.id);
      let html = p.promptHtml;
      // 빈칸을 답/정답/입력값으로 치환
      html = html.replace(/<span class="blank" data-bi="(\d+)"[^>]*><\/span>/g, (mt, bi) => {
        bi = +bi;
        const key = p.id + "_" + bi;
        // 부모 정답지: 정답 노출
        if (opts.showAnswers) {
          return `<span class="blank answer">${escapeHtml(p.blanks[bi])}</span>`;
        }
        const val = asg.answers[key];
        const shown = val != null && val !== "" ? escapeHtml(val) : "";
        // 정답으로 고정된 문제: 초록 표시 + 비활성 (다시 풀기에도 유지)
        if (isLocked) {
          return `<span class="blank correct">${shown}</span>`;
        }
        // 제출 후 틀린 문제: 빨강 표시. 단, 정답은 노출하지 않음(학생).
        if (opts.result) {
          return `<span class="blank wrong"><span class="bad-val">${shown || "·"}</span></span>`;
        }
        // 풀이 중: 입력 가능
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
          <div class="ws-info"><div>${m.gradeLabel} ${m.sem}</div><div class="ws-unit">${m.unit}</div><div class="ws-lvl">${m.level}</div></div>
        </div>
        <h4 class="ws-title">${m.title}</h4>
        <div class="ws-grid">${cells}</div>
      </div>`;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

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
        if (k === "assign-grade") { assignSel.gradeId = el.value; assignSel.unitIdx = 0; assignSel.levelId = null; syncSel(assignSel); render(); }
        else if (k === "assign-unit") { assignSel.unitIdx = +el.value; assignSel.levelId = null; syncSel(assignSel); render(); }
        else if (k === "assign-level") { assignSel.levelId = el.value; }
        else if (k === "assign-count") { assignSel.count = clampInt(el.value, 2, 40, 10); }
      });
    });

    // 학생 빈칸 클릭 → 손글씨
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
    const a = buildAssignment({ levelId: assignSel.levelId, count: assignSel.count }, today());
    if (!a) { Modal.alert("오류", "문제를 생성하지 못했습니다."); return; }
    state.assignment = a;
    saveState();
    Modal.alert("출제 완료", `${a.meta.gradeLabel} · ${a.meta.level} ${a.problems.length}문제를 학생에게 출제했어요.`, () => render());
  }

  /* ---------- 학생: 빈칸 입력 ---------- */
  function openBlank(key) {
    HW.open({
      onComplete: (digits) => {
        state.assignment.answers[key] = digits;
        saveState();
        render();
        afterFill();
      },
    });
  }

  function afterFill() {
    const asg = state.assignment;
    if (!asg || asg.status === "submitted") return;
    if (filledBlanks(asg) >= totalBlanks(asg)) {
      // 모든 답란이 채워짐 → 제출/다시풀기
      Modal.show({
        title: "다 풀었어요!",
        bodyHtml: `<p class="modal-text">답을 모두 입력했어요. 제출할까요?</p>`,
        buttons: [
          // 제출 전 "다시 풀기"는 닫기만 — 답란을 다시 눌러 고쳐 쓸 수 있음(지우지 않음)
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
    // 정답 문제를 고정(locked) — 다시 풀기 시 유지
    if (!Array.isArray(asg.locked)) asg.locked = [];
    asg.problems.forEach((p) => {
      if (!result.wrong.includes(p.id) && !asg.locked.includes(p.id)) asg.locked.push(p.id);
    });
    // 부모님 모드 제출 기록 (제출시간/점수/틀린 번호)
    if (!Array.isArray(state.history)) state.history = [];
    state.history.unshift({
      at: new Date().toISOString(),
      gradeLabel: asg.meta.gradeLabel,
      level: asg.meta.level,
      score: result.score,
      total: result.total,
      wrong: result.wrong.slice(),
    });
    if (state.history.length > 100) state.history = state.history.slice(0, 100);
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
    schSel = { gradeId: "1", unitIdx: 0, levelId: eff.levelId || null, count: eff.count || 10 };
    if (eff.levelId) { const f = Curriculum.findLevel(eff.levelId); if (f) { schSel.gradeId = f.grade.id; schSel.unitIdx = f.grade.units.indexOf(f.unit); } }
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
        { label: "이 날짜만", kind: "ghost", onClick: () => { state.scheduleOverrides[ds] = { levelId: schSel.levelId, count: schSel.count }; saveState(); Modal.close(); render(); } },
        { label: "같은 요일 모두", kind: "primary", onClick: () => { state.schedule[wd] = { levelId: schSel.levelId, count: schSel.count }; delete state.scheduleOverrides[ds]; saveState(); Modal.close(); render(); } },
      ],
    });
    // 모달 내 셀렉터 바인딩
    setTimeout(() => bindSchSelectors(), 30);
  }

  function bindSchSelectors() {
    document.querySelectorAll('[data-sel^="sch-"]').forEach((el) => {
      el.addEventListener("change", () => {
        const k = el.getAttribute("data-sel");
        if (k === "sch-grade") { schSel.gradeId = el.value; schSel.unitIdx = 0; schSel.levelId = null; }
        else if (k === "sch-unit") { schSel.unitIdx = +el.value; schSel.levelId = null; }
        else if (k === "sch-level") { schSel.levelId = el.value; return; }
        else if (k === "sch-count") { schSel.count = clampInt(el.value, 2, 40, 10); return; }
        syncSel(schSel);
        // 셀렉터 재렌더
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
        btn.addEventListener("click", () => { if (!b.keepOpen) {} b.onClick && b.onClick(); });
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
  render();
})();
