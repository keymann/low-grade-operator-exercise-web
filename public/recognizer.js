/*
 * recognizer.js — 클라이언트 측 손글씨 숫자 인식 (MNIST / ONNX Runtime Web)
 *
 * Recognizer.recognize(canvas) -> Promise<string>
 *   - 캔버스의 잉크를 이진화 → 좌우로 숫자 단위 분할(열 투영) → 각 숫자를
 *     MNIST 규격(28×28, 무게중심 정렬)으로 정규화 → ONNX MNIST 모델로 분류
 *   - 소수점(.)은 보수적으로만 인식. 결과는 숫자 문자열.
 *
 * 백엔드/네트워크 의존 없음(오프라인). ORT 런타임/모델은 /vendor, /models 에 동봉.
 */
(function () {
  "use strict";

  const MODEL_URL = "/models/mnist-12.onnx";
  // MNIST(모델 zoo) 입력은 전경(획)=높은 값, 0~255 범위. 테스트로 검증된 값.
  const CFG = { scale: 255, inkLum: 140, minInk: 10, minDigitH: 8, minDigitW: 3 };

  let sessionPromise = null;
  function getSession() {
    if (!sessionPromise) {
      if (typeof ort === "undefined") return Promise.reject(new Error("ORT not loaded"));
      ort.env.wasm.wasmPaths = "/vendor/ort/";
      ort.env.wasm.numThreads = 1;
      sessionPromise = ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
    }
    return sessionPromise;
  }

  // 워밍업(모델/런타임 선로딩) — 팝업 열릴 때 호출하면 첫 인식이 빨라짐
  function warmup() { try { getSession().catch(() => {}); } catch (e) {} }

  /* 캔버스 → 이진 잉크 마스크 */
  function canvasToMask(canvas) {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
      const lum = (r + g + b) / 3;
      mask[i] = a > 10 && lum < CFG.inkLum ? 1 : 0;
    }
    return { mask, w, h };
  }

  /* 열 투영 기반 좌→우 분할. 반환: [{x0,x1,y0,y1,ink,isDot}] */
  function segment(mask, w, h) {
    const col = new Int32Array(w);
    let total = 0;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = 0; y < h; y++) s += mask[y * w + x];
      col[x] = s; total += s;
    }
    if (total < CFG.minInk) return [];

    // 비어있지 않은 열의 연속 구간(run) 찾기 — 1열 정도의 빈틈은 병합
    const runs = [];
    let x = 0;
    const gapMerge = Math.max(2, Math.round(w * 0.012));
    while (x < w) {
      if (col[x] === 0) { x++; continue; }
      let x0 = x, gap = 0, x1 = x;
      while (x < w) {
        if (col[x] > 0) { x1 = x; gap = 0; }
        else if (++gap > gapMerge) break;
        x++;
      }
      runs.push({ x0, x1 });
    }

    // 각 run 의 세로 잉크 범위 계산 + 박스화
    const boxes = [];
    let maxH = 0;
    for (const r of runs) {
      let y0 = h, y1 = -1, ink = 0;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = r.x0; xx <= r.x1; xx++) {
          if (mask[yy * w + xx]) { if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; ink++; }
        }
      }
      if (y1 < 0) continue;
      const bx = { x0: r.x0, x1: r.x1, y0, y1, ink };
      boxes.push(bx);
      maxH = Math.max(maxH, y1 - y0 + 1);
    }

    // 노이즈/소수점 판별
    const result = [];
    for (const b of boxes) {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      const small = bh < maxH * 0.45 && bw < maxH * 0.45;
      const lowerHalf = b.y0 + bh / 2 > h * 0.55;
      if (small && lowerHalf && b.ink >= 4) { b.isDot = true; result.push(b); continue; }
      if (bh < CFG.minDigitH || bw < CFG.minDigitW || b.ink < CFG.minInk) continue; // 노이즈
      b.isDot = false;
      result.push(b);
    }
    result.sort((a, b) => a.x0 - b.x0);
    return result;
  }

  /* 숫자 박스 → 28×28 Float32Array (무게중심 28×28 중앙 정렬) */
  function preprocess(mask, w, h, box) {
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    const scale = 20 / Math.max(bw, bh);
    const sw = Math.max(1, Math.round(bw * scale)), sh = Math.max(1, Math.round(bh * scale));
    const small = new Float32Array(sw * sh);
    for (let ty = 0; ty < sh; ty++) {
      for (let tx = 0; tx < sw; tx++) {
        const sx0 = box.x0 + Math.floor((tx * bw) / sw), sx1 = box.x0 + Math.floor(((tx + 1) * bw) / sw);
        const sy0 = box.y0 + Math.floor((ty * bh) / sh), sy1 = box.y0 + Math.floor(((ty + 1) * bh) / sh);
        let sum = 0, cnt = 0;
        for (let yy = sy0; yy < Math.max(sy0 + 1, sy1); yy++) {
          for (let xx = sx0; xx < Math.max(sx0 + 1, sx1); xx++) { sum += mask[yy * w + xx]; cnt++; }
        }
        small[ty * sw + tx] = cnt ? sum / cnt : 0;
      }
    }
    // 무게중심
    let mx = 0, my = 0, ms = 0;
    for (let y = 0; y < sh; y++) for (let xx = 0; xx < sw; xx++) { const v = small[y * sw + xx]; mx += v * xx; my += v * y; ms += v; }
    mx = ms ? mx / ms : sw / 2; my = ms ? my / ms : sh / 2;
    const offx = Math.round(14 - mx), offy = Math.round(14 - my);
    const out = new Float32Array(28 * 28);
    for (let y = 0; y < sh; y++) {
      for (let xx = 0; xx < sw; xx++) {
        const dx = xx + offx, dy = y + offy;
        if (dx >= 0 && dx < 28 && dy >= 0 && dy < 28) out[dy * 28 + dx] = small[y * sw + xx] * CFG.scale;
      }
    }
    return out;
  }

  function argmax(arr) { let bi = 0, bv = -Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; } return { idx: bi, val: bv }; }

  async function recognize(canvas) {
    const { mask, w, h } = canvasToMask(canvas);
    const boxes = segment(mask, w, h);
    if (!boxes.length) return "";
    const session = await getSession();
    const inName = session.inputNames[0], outName = session.outputNames[0];
    let str = "";
    const debug = [];
    for (const box of boxes) {
      if (box.isDot) { if (str && str.indexOf(".") < 0) str += "."; debug.push({ d: "." }); continue; }
      const input = preprocess(mask, w, h, box);
      const res = await session.run({ [inName]: new ort.Tensor("float32", input, [1, 1, 28, 28]) });
      const logits = res[outName].data;
      const { idx } = argmax(logits);
      str += String(idx);
      debug.push({ d: idx });
    }
    window.__recoDebug = { boxes: boxes.length, debug, str };
    // 끝이 "." 이면 제거
    return str.replace(/\.$/, "");
  }

  window.Recognizer = { recognize, warmup };
})();
