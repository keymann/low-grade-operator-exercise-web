/*
 * handwriting.js — 손글씨 입력 팝업 + OCR
 *
 * HW.open({ title, onComplete(digits), onCancel })
 *   - 캔버스에 손글씨를 쓰고 [완료] 시 /api/ocr 로 숫자 변환 후 onComplete(digits)
 *   - [다시쓰기] 캔버스 초기화
 *   - [취소] 팝업만 닫기 (onCancel)
 */
(function () {
  "use strict";

  let overlay, canvas, ctx, statusEl, doneBtn;
  let drawing = false, hasInk = false, last = null;
  let cb = { onComplete: null, onCancel: null };

  function build() {
    overlay = document.createElement("div");
    overlay.className = "hw-overlay";
    overlay.innerHTML = `
      <div class="hw-popup" role="dialog" aria-modal="true" aria-label="손글씨 입력">
        <div class="hw-title">답을 손글씨로 써주세요</div>
        <div class="hw-canvas-wrap">
          <canvas class="hw-canvas"></canvas>
          <div class="hw-hint">여기에 숫자를 쓰세요</div>
        </div>
        <div class="hw-status" aria-live="polite"></div>
        <div class="hw-buttons">
          <button class="btn btn-ghost" data-act="cancel">취소</button>
          <button class="btn btn-ghost" data-act="clear">다시쓰기</button>
          <button class="btn btn-primary" data-act="done">완료</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    canvas = overlay.querySelector(".hw-canvas");
    ctx = canvas.getContext("2d");
    statusEl = overlay.querySelector(".hw-status");
    doneBtn = overlay.querySelector('[data-act="done"]');

    overlay.addEventListener("click", (e) => { if (e.target === overlay) doCancel(); });
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", doCancel);
    overlay.querySelector('[data-act="clear"]').addEventListener("click", clearCanvas);
    doneBtn.addEventListener("click", doDone);

    // 포인터 입력 (마우스 + 터치 통합)
    canvas.addEventListener("pointerdown", startDraw);
    canvas.addEventListener("pointermove", moveDraw);
    window.addEventListener("pointerup", endDraw);
    // 터치 스크롤 방지
    canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }

  function sizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBg();
  }

  function paintBg() {
    const rect = canvas.getBoundingClientRect();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = Math.max(6, rect.width / 45);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function startDraw(e) {
    drawing = true; hasInk = true; last = pos(e);
    overlay.querySelector(".hw-hint").style.display = "none";
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  function moveDraw(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }
  function endDraw() { drawing = false; }

  function clearCanvas() {
    paintBg();
    hasInk = false;
    overlay.querySelector(".hw-hint").style.display = "";
    setStatus("");
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "hw-status" + (kind ? " " + kind : "");
  }

  function setBusy(b) {
    doneBtn.disabled = b;
    doneBtn.textContent = b ? "인식 중…" : "완료";
  }

  async function doDone() {
    if (!hasInk) { setStatus("먼저 숫자를 써주세요.", "err"); return; }
    setBusy(true);
    setStatus("인식하고 있어요…");
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      const digits = (data && data.digits) ? String(data.digits) : "";
      if (!digits) {
        setStatus("숫자를 알아보지 못했어요. 다시 써볼까요?", "err");
        setBusy(false);
        return;
      }
      close();
      cb.onComplete && cb.onComplete(digits);
    } catch (err) {
      console.error(err);
      setStatus("인식에 실패했어요. 다시 시도해주세요.", "err");
      setBusy(false);
    }
  }

  function doCancel() {
    close();
    cb.onCancel && cb.onCancel();
  }

  function close() {
    overlay.classList.remove("show");
    document.body.classList.remove("no-scroll");
  }

  function open(opts) {
    if (!overlay) build();
    cb = { onComplete: opts.onComplete, onCancel: opts.onCancel };
    if (opts.title) overlay.querySelector(".hw-title").textContent = opts.title;
    setBusy(false);
    overlay.classList.add("show");
    document.body.classList.add("no-scroll");
    // 표시 후 크기 측정 (display 적용 뒤)
    requestAnimationFrame(() => { sizeCanvas(); clearCanvas(); });
  }

  window.HW = { open };
})();
