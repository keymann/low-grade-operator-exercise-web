/*
 * numberpad.js — 답 입력용 숫자 패드 (손글씨 대체)
 *
 *  - 답란을 선택하면 화면에 떠 있는 패드가 열린다.
 *  - 숫자/소수점/지우기 입력은 onInput 콜백으로 즉시 전달되어 답란에 반영된다.
 *  - 헤더를 롱탭(길게 눌러)한 뒤 드래그하면 화면 위에서 자유롭게 이동할 수 있다.
 *  - 닫기(✕) 버튼으로 패드를 닫는다.
 *
 *  window.Numberpad.open({ title, value, onInput(value), onClose() })
 */
(function () {
  "use strict";

  let el, titleEl, displayEl;
  let cur = "";
  let onInput = null, onClose = null;
  let pos = null;            // { left, top } — 닫아도 위치 기억
  const MAX_LEN = 9;

  function build() {
    if (el) return;
    el = document.createElement("div");
    el.className = "npad";
    el.innerHTML =
      `<div class="npad-head">` +
        `<span class="npad-grip" aria-hidden="true">⠿</span>` +
        `<span class="npad-title"></span>` +
        `<button class="npad-close" type="button" aria-label="닫기">✕</button>` +
      `</div>` +
      `<div class="npad-display" aria-live="polite"></div>` +
      `<div class="npad-grid">` +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="npad-key" type="button" data-k="${n}">${n}</button>`).join("") +
        `<button class="npad-key npad-dot" type="button" data-k=".">.</button>` +
        `<button class="npad-key" type="button" data-k="0">0</button>` +
        `<button class="npad-key npad-back" type="button" data-k="back">⌫</button>` +
      `</div>`;
    document.body.appendChild(el);
    titleEl = el.querySelector(".npad-title");
    displayEl = el.querySelector(".npad-display");
    el.querySelector(".npad-close").addEventListener("click", close);
    el.querySelectorAll(".npad-key").forEach((b) => {
      b.addEventListener("click", () => press(b.getAttribute("data-k")));
    });
    setupDrag();
  }

  function press(k) {
    if (k === "back") {
      cur = cur.slice(0, -1);
    } else if (k === ".") {
      if (!cur.includes(".")) cur += cur === "" ? "0." : ".";
    } else {
      if (cur === "0") cur = k; else cur += k;
      if (cur.length > MAX_LEN) cur = cur.slice(0, MAX_LEN);
    }
    updateDisplay();
    onInput && onInput(cur);
  }

  function updateDisplay() { displayEl.textContent = cur === "" ? " " : cur; }

  function open(opts) {
    build();
    titleEl.textContent = opts.title || "답 입력";
    cur = opts.value != null ? String(opts.value) : "";
    onInput = opts.onInput || null;
    onClose = opts.onClose || null;
    updateDisplay();
    el.classList.add("show");
    place();
  }

  function close() {
    if (!el) return;
    el.classList.remove("show");
    const cb = onClose;
    onClose = null; onInput = null;
    cb && cb();
  }

  function isOpen() { return !!(el && el.classList.contains("show")); }

  function place() {
    if (!pos) {
      const w = el.offsetWidth || 260, h = el.offsetHeight || 340;
      pos = { left: Math.max(8, (window.innerWidth - w) / 2), top: Math.max(8, window.innerHeight - h - 24) };
    }
    clampAndApply();
  }

  function clampAndApply() {
    const w = el.offsetWidth, h = el.offsetHeight;
    pos.left = Math.min(Math.max(8, pos.left), Math.max(8, window.innerWidth - w - 8));
    pos.top = Math.min(Math.max(8, pos.top), Math.max(8, window.innerHeight - h - 8));
    el.style.left = pos.left + "px";
    el.style.top = pos.top + "px";
  }

  // 롱탭 후 드래그 이동
  function setupDrag() {
    const head = el.querySelector(".npad-head");
    let timer = null, startX = 0, startY = 0, origin = null, active = false;

    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".npad-close")) return;
      startX = e.clientX; startY = e.clientY;
      origin = { left: pos.left, top: pos.top };
      timer = setTimeout(() => {
        active = true;
        el.classList.add("dragging");
        try { head.setPointerCapture(e.pointerId); } catch (_) {}
      }, 350);
    });
    head.addEventListener("pointermove", (e) => {
      if (!active) {
        if (timer && (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12)) { clearTimeout(timer); timer = null; }
        return;
      }
      e.preventDefault();
      pos.left = origin.left + (e.clientX - startX);
      pos.top = origin.top + (e.clientY - startY);
      clampAndApply();
    });
    const endDrag = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (active) { active = false; el.classList.remove("dragging"); }
    };
    head.addEventListener("pointerup", endDrag);
    head.addEventListener("pointercancel", endDrag);
  }

  window.addEventListener("resize", () => { if (isOpen()) clampAndApply(); });

  window.Numberpad = { open, close, isOpen };
})();
