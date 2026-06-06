/*
 * problems.js — 일일수학 커리큘럼 카탈로그 + 문제 생성기
 *
 * 문제 모델:
 *   { promptHtml: string, blanks: string[] }
 *   - promptHtml 안의 빈칸은 <span class="blank" data-bi="N"> 로 표시
 *   - blanks[N] 은 N번 빈칸의 정답 문자열
 *
 * 커리큘럼(학년군 → 세부항목 2단):
 *   GROUPS[] → group.items[]
 *   item = { id, group, hint, name, gen() }   ( gen 은 문제 모델을 반환 )
 */
(function () {
  "use strict";

  /* ---------- 유틸 ---------- */
  const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
  function trimNum(s) { return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s; }

  /* ---------- 렌더 헬퍼 (HTML 문자열) ---------- */
  const T = (s) => `<span class="t">${s}</span>`;
  const OP = (s) => `<span class="op">${s}</span>`;
  const B = (i) => `<span class="blank" data-bi="${i}" tabindex="0" role="button" aria-label="답 입력"></span>`;
  const fr = (n, d) => `<span class="frac"><span class="fn">${n}</span><span class="fl"></span><span class="fd">${d}</span></span>`;
  const frB = (ni, di) => `<span class="frac"><span class="fn">${B(ni)}</span><span class="fl"></span><span class="fd">${B(di)}</span></span>`;
  // 대분수: 정수부 + 분수
  const mixed = (w, n, d) => `<span class="mixed">${T(w)}${fr(n, d)}</span>`;
  const mixedB = (wi, ni, di) => `<span class="mixed">${B(wi)}${frB(ni, di)}</span>`;
  const expr = (inner) => `<span class="expr">${inner}</span>`;
  // 세로셈(세로식): 두 수를 자릿수 오른쪽 정렬해 위아래로 쌓고, 아래에 답 빈칸.
  function vexpr(a, opSym, b, ansBlank) {
    return `<span class="vexpr">` +
      `<span class="vop"></span><span class="vnum">${a}</span>` +
      `<span class="vop">${opSym}</span><span class="vnum">${b}</span>` +
      `<span class="vline"></span>` +
      `<span class="vans">${ansBlank}</span>` +
      `</span>`;
  }

  /* ---------- 가로식 공용 생성기 ---------- */
  // a (op) b = ☐ (가로)
  function binGen(opSym, fn, genA, genB) {
    return () => {
      let a = genA(), b = genB();
      let ans = fn(a, b);
      if (ans < 0) { [a, b] = [b, a]; ans = fn(a, b); }
      return { promptHtml: expr(T(a) + OP(opSym) + T(b) + OP("=") + B(0)), blanks: [String(ans)] };
    };
  }
  // 세 수의 계산: a (op) b (op) c = ☐
  function threeGen(maxStep) {
    return () => {
      const ops = [pick(["+", "−"]), pick(["+", "−"])];
      let a = ri(2, maxStep), cur = a, html = T(a);
      for (const o of ops) {
        let n;
        if (o === "−") { n = ri(1, cur); cur -= n; } else { n = ri(1, maxStep); cur += n; }
        html += OP(o) + T(n);
      }
      return { promptHtml: expr(html + OP("=") + B(0)), blanks: [String(cur)] };
    };
  }
  // 곱셈구구
  function timesTableGen(table) {
    return () => {
      const b = ri(1, 9);
      const [x, y] = Math.random() < 0.5 ? [table, b] : [b, table];
      return { promptHtml: expr(T(x) + OP("×") + T(y) + OP("=") + B(0)), blanks: [String(x * y)] };
    };
  }
  // 나눗셈 (나머지 없음, 가로)
  function divExactGen(genDivisor, genQuotient) {
    return () => {
      const d = genDivisor(), q = genQuotient();
      return { promptHtml: expr(T(d * q) + OP("÷") + T(d) + OP("=") + B(0)), blanks: [String(q)] };
    };
  }
  // 나눗셈 (몫과 나머지) → 빈칸 2개
  function divRemGen(genDivisor, genQuotient) {
    return () => {
      const d = genDivisor(), q = genQuotient(), r = ri(1, d - 1);
      const dividend = d * q + r;
      return {
        promptHtml: expr(T(dividend) + OP("÷") + T(d) + OP("=") + B(0) + OP("…") + B(1)),
        blanks: [String(q), String(r)],
      };
    };
  }
  // 나눗셈의 검산: a ÷ b = q … r 에 대해  b × q + r = ☐(=a)
  function divCheckGen(genDivisor, genQuotient, allowRem) {
    return () => {
      const d = genDivisor(), q = genQuotient(), r = allowRem ? ri(0, d - 1) : 0;
      const dividend = d * q + r;
      const rpart = r > 0 ? OP("+") + T(r) : "";
      return {
        promptHtml: expr(T(d) + OP("×") + T(q) + rpart + OP("=") + B(0)),
        blanks: [String(dividend)],
      };
    };
  }

  /* ---------- 세로식 생성기 ---------- */
  function vBinGen(opSym, fn, genA, genB) {
    return () => {
      let a = genA(), b = genB();
      let ans = fn(a, b);
      if (ans < 0) { [a, b] = [b, a]; ans = fn(a, b); }
      return { promptHtml: vexpr(a, opSym, b, B(0)), blanks: [String(ans)] };
    };
  }
  // 덧셈/뺄셈 섞어서 (세로)
  function vAddSubGen(genA, genB) {
    return () => {
      const add = Math.random() < 0.5;
      let a = genA(), b = genB();
      if (!add && a < b) [a, b] = [b, a];
      const ans = add ? a + b : a - b;
      return { promptHtml: vexpr(a, add ? "+" : "−", b, B(0)), blanks: [String(ans)] };
    };
  }
  function vMulGen(genA, genB) {
    return () => {
      const a = genA(), b = genB();
      return { promptHtml: vexpr(a, "×", b, B(0)), blanks: [String(a * b)] };
    };
  }

  /* ---------- 분수/소수/단위 생성기 ---------- */
  // 분모가 같은 진분수의 덧셈/뺄셈 (약분하지 않음, 진분수 결과 유지)
  function sameDenProperGen(isAdd) {
    return () => {
      const d = ri(3, 12);
      let n1 = ri(1, d - 1), n2 = ri(1, d - 1);
      if (isAdd) {
        // 합이 진분수가 되도록
        while (n1 + n2 >= d) { n1 = ri(1, d - 1); n2 = ri(1, d - 1); }
        const left = fr(n1, d) + OP("+") + fr(n2, d);
        return { promptHtml: expr(left + OP("=") + frB(0, 1)), blanks: [String(n1 + n2), String(d)] };
      }
      if (n1 < n2) [n1, n2] = [n2, n1];
      if (n1 === n2) n1 = Math.min(d - 1, n2 + 1);
      const left = fr(n1, d) + OP("−") + fr(n2, d);
      return { promptHtml: expr(left + OP("=") + frB(0, 1)), blanks: [String(n1 - n2), String(d)] };
    };
  }
  // 분모가 같은 대분수의 덧셈/뺄셈 (받아올림/내림 없음)
  function sameDenMixedGen(isAdd) {
    return () => {
      const d = ri(3, 9);
      if (isAdd) {
        let n1 = ri(1, d - 2), n2 = ri(1, d - 1 - n1);
        const w1 = ri(1, 4), w2 = ri(1, 4);
        const left = mixed(w1, n1, d) + OP("+") + mixed(w2, n2, d);
        return { promptHtml: expr(left + OP("=") + mixedB(0, 1, 2)), blanks: [String(w1 + w2), String(n1 + n2), String(d)] };
      }
      let n1 = ri(2, d - 1), n2 = ri(1, n1 - 1);
      let w1 = ri(3, 6), w2 = ri(1, w1 - 1);
      const left = mixed(w1, n1, d) + OP("−") + mixed(w2, n2, d);
      return { promptHtml: expr(left + OP("=") + mixedB(0, 1, 2)), blanks: [String(w1 - w2), String(n1 - n2), String(d)] };
    };
  }
  // 대분수와 진분수의 덧셈과 뺄셈 (받아올림/내림 없음)
  function mixedProperGen() {
    return () => {
      const d = ri(3, 9), isAdd = Math.random() < 0.5;
      const w = ri(1, 5);
      if (isAdd) {
        let n1 = ri(1, d - 2), n2 = ri(1, d - 1 - n1);
        const left = mixed(w, n1, d) + OP("+") + fr(n2, d);
        return { promptHtml: expr(left + OP("=") + mixedB(0, 1, 2)), blanks: [String(w), String(n1 + n2), String(d)] };
      }
      let n1 = ri(2, d - 1), n2 = ri(1, n1 - 1);
      const left = mixed(w, n1, d) + OP("−") + fr(n2, d);
      return { promptHtml: expr(left + OP("=") + mixedB(0, 1, 2)), blanks: [String(w), String(n1 - n2), String(d)] };
    };
  }
  // 가분수 ↔ 대분수 변환
  function fracConvertGen() {
    return () => {
      const d = ri(3, 9), w = ri(1, 5), rem = ri(1, d - 1);
      const improper = w * d + rem;
      if (Math.random() < 0.5) {
        // 가분수 → 대분수
        return { promptHtml: expr(fr(improper, d) + OP("=") + mixedB(0, 1, 2)), blanks: [String(w), String(rem), String(d)] };
      }
      // 대분수 → 가분수
      return { promptHtml: expr(mixed(w, rem, d) + OP("=") + frB(0, 1)), blanks: [String(improper), String(d)] };
    };
  }
  // 소수 덧셈/뺄셈 (자릿수 같음)
  function decimalSameGen(isAdd, places) {
    return () => {
      const scale = Math.pow(10, places);
      let a = ri(1, 9 * scale) / scale, b = ri(1, 9 * scale) / scale;
      a = +a.toFixed(places); b = +b.toFixed(places);
      let ans = isAdd ? a + b : a - b;
      if (!isAdd && ans < 0) { [a, b] = [b, a]; ans = a - b; }
      ans = +ans.toFixed(places);
      return {
        promptHtml: expr(T(a.toFixed(places)) + OP(isAdd ? "+" : "−") + T(b.toFixed(places)) + OP("=") + B(0)),
        blanks: [trimNum(ans.toFixed(places))],
      };
    };
  }
  // 소수 덧셈/뺄셈 (자릿수 다름: 한 자리 + 두 자리)
  function decimalDiffGen(isAdd) {
    return () => {
      let a = +(ri(1, 90) / 10).toFixed(1);     // 소수 한 자리
      let b = +(ri(1, 900) / 100).toFixed(2);   // 소수 두 자리
      if (Math.random() < 0.5) { const t = a; a = b; b = t; } // 위치 섞기
      let ans = isAdd ? a + b : a - b;
      if (!isAdd && ans < 0) { [a, b] = [b, a]; ans = a - b; }
      ans = +ans.toFixed(2);
      const fmt = (x) => trimNum(x.toFixed(2));
      return {
        promptHtml: expr(T(fmt(a)) + OP(isAdd ? "+" : "−") + T(fmt(b)) + OP("=") + B(0)),
        blanks: [trimNum(ans.toFixed(2))],
      };
    };
  }
  // 들이의 단위 (L ↔ mL)
  function capacityGen() {
    return () => {
      if (Math.random() < 0.5) {
        // ? L ? mL = ? mL
        const l = ri(1, 5), ml = ri(1, 9) * 100;
        return { promptHtml: expr(`<span class="t">${l} L ${ml} mL</span>` + OP("=") + B(0) + `<span class="t">mL</span>`), blanks: [String(l * 1000 + ml)] };
      }
      // ? mL = ? L ? mL  → 단일 답(L)로 단순화: ? L = ? mL
      const l = ri(2, 8);
      return { promptHtml: expr(`<span class="t">${l} L</span>` + OP("=") + B(0) + `<span class="t">mL</span>`), blanks: [String(l * 1000)] };
    };
  }

  /* ---------- 5~6학년군 생성기 ---------- */
  const lcm = (a, b) => (a / gcd(a, b)) * b;
  const paren = (s) => `<span class="t">(</span>${s}<span class="t">)</span>`;

  // 두 수의 단일 연산(정수·비음수·정확한 나눗셈만 허용). 실패 시 {ok:false}.
  function evalBin(x, op, y) {
    if (x == null || y == null) return { ok: false };
    if (op === "+") return { ok: true, val: x + y };
    if (op === "−") { const v = x - y; return v < 0 ? { ok: false } : { ok: true, val: v }; }
    if (op === "×") return { ok: true, val: x * y };
    if (op === "÷") { if (y === 0 || x % y !== 0) return { ok: false }; return { ok: true, val: x / y }; }
    return { ok: false };
  }
  // 3항 식 평가 (mode 0: 우선순위, 1: (a∘b)∘c, 2: a∘(b∘c))
  function evalExpr(a, op1, b, op2, c, mode) {
    const prec = (o) => (o === "×" || o === "÷" ? 2 : 1);
    if (mode === 1) { const r = evalBin(a, op1, b); return r.ok ? evalBin(r.val, op2, c) : r; }
    if (mode === 2) { const r = evalBin(b, op2, c); return r.ok ? evalBin(a, op1, r.val) : r; }
    if (prec(op1) >= prec(op2)) { const r = evalBin(a, op1, b); return r.ok ? evalBin(r.val, op2, c) : r; }
    const r = evalBin(b, op2, c); return r.ok ? evalBin(a, op1, r.val) : r;
  }
  function mixedHtml(a, op1, b, op2, c, mode) {
    if (mode === 1) return paren(T(a) + OP(op1) + T(b)) + OP(op2) + T(c);
    if (mode === 2) return T(a) + OP(op1) + paren(T(b) + OP(op2) + T(c));
    return T(a) + OP(op1) + T(b) + OP(op2) + T(c);
  }
  // 혼합 계산: ops 에서 두 연산자 선택, 음이 아닌 정수·정확한 나눗셈이 될 때까지 재시도
  function mixedCalcGen(ops, useParens) {
    return () => {
      for (let t = 0; t < 400; t++) {
        const op1 = pick(ops), op2 = pick(ops);
        const a = ri(2, 20), b = ri(2, 12), c = ri(2, 12);
        const mode = useParens ? pick([0, 1, 2]) : 0;
        const r = evalExpr(a, op1, b, op2, c, mode);
        if (!r.ok || r.val < 0) continue;
        return { promptHtml: expr(mixedHtml(a, op1, b, op2, c, mode) + OP("=") + B(0)), blanks: [String(r.val)] };
      }
      const a = ri(2, 9), b = ri(2, 9);
      return { promptHtml: expr(T(a) + OP("+") + T(b) + OP("=") + B(0)), blanks: [String(a + b)] };
    };
  }

  // 약수와 배수: 최대공약수 / 최소공배수
  function gcdLcmGen() {
    return () => {
      const a = ri(4, 24), b = ri(4, 24);
      const wantLcm = Math.random() < 0.5;
      const ans = wantLcm ? lcm(a, b) : gcd(a, b);
      const label = wantLcm ? "최소공배수" : "최대공약수";
      return { promptHtml: expr(`<span class="t">${a}, ${b} 의 ${label}</span>` + OP("=") + B(0)), blanks: [String(ans)] };
    };
  }
  // 약분 → 기약분수
  function reduceGen() {
    return () => {
      let rn, rd;
      do { rn = ri(1, 6); rd = ri(2, 9); } while (gcd(rn, rd) !== 1 || rn >= rd);
      const g = ri(2, 9);
      return { promptHtml: expr(fr(rn * g, rd * g) + OP("=") + frB(0, 1)), blanks: [String(rn), String(rd)] };
    };
  }
  // 분수 → 소수 (유한소수)
  function fracToDecimalGen() {
    return () => {
      const d = pick([2, 4, 5, 8, 10, 20, 25, 50]);
      const n = ri(1, d - 1);
      return { promptHtml: expr(fr(n, d) + OP("=") + B(0)), blanks: [trimNum((n / d).toFixed(4))] };
    };
  }
  // 이분모 분수의 덧셈/뺄셈 → 기약분수
  function fracAddSubDiffGen() {
    return () => {
      const isAdd = Math.random() < 0.5;
      let d1 = ri(2, 8), d2 = ri(2, 8);
      while (d1 === d2 || lcm(d1, d2) > 48) { d1 = ri(2, 8); d2 = ri(2, 8); }
      let n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1);
      const L = lcm(d1, d2);
      let num = isAdd ? n1 * (L / d1) + n2 * (L / d2) : n1 * (L / d1) - n2 * (L / d2);
      if (!isAdd && num <= 0) { [d1, d2, n1, n2] = [d2, d1, n2, n1]; num = n1 * (L / d1) - n2 * (L / d2); }
      if (num === 0) num = 1;
      const g = gcd(Math.abs(num), L) || 1;
      const left = fr(n1, d1) + OP(isAdd ? "+" : "−") + fr(n2, d2);
      return { promptHtml: expr(left + OP("=") + frB(0, 1)), blanks: [String(num / g), String(L / g)] };
    };
  }
  // 분수의 곱셈 → 기약분수
  function fracMulGen() {
    return () => {
      const d1 = ri(2, 7), d2 = ri(2, 7);
      const n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1);
      const num = n1 * n2, den = d1 * d2, g = gcd(num, den) || 1;
      return { promptHtml: expr(fr(n1, d1) + OP("×") + fr(n2, d2) + OP("=") + frB(0, 1)), blanks: [String(num / g), String(den / g)] };
    };
  }
  // (소수)×(자연수), (소수)×(소수)
  function decimalNatMulGen() {
    return () => {
      const a = ri(11, 99) / 10, b = ri(2, 9);
      return { promptHtml: expr(T(a.toFixed(1)) + OP("×") + T(b) + OP("=") + B(0)), blanks: [trimNum((a * b).toFixed(2))] };
    };
  }
  function decimalMulGen() {
    return () => {
      const a = ri(11, 99) / 10, b = ri(11, 99) / 10;
      return { promptHtml: expr(T(a.toFixed(1)) + OP("×") + T(b.toFixed(1)) + OP("=") + B(0)), blanks: [trimNum((a * b).toFixed(2))] };
    };
  }
  // (분수)÷(자연수) → 기약분수
  function fracDivNatGen() {
    return () => {
      const b = ri(2, 9), a = ri(1, b - 1), n = ri(2, 9);
      const num = a, den = b * n, g = gcd(num, den) || 1;
      return { promptHtml: expr(fr(a, b) + OP("÷") + T(n) + OP("=") + frB(0, 1)), blanks: [String(num / g), String(den / g)] };
    };
  }
  // (소수)÷(자연수), 나누어떨어지게
  function decimalNatDivGen() {
    return () => {
      const q = ri(11, 99) / 10, n = ri(2, 9);
      const dividend = +(q * n).toFixed(1);
      return { promptHtml: expr(T(dividend.toFixed(1)) + OP("÷") + T(n) + OP("=") + B(0)), blanks: [trimNum(q.toFixed(1))] };
    };
  }
  // 비율(유한소수)
  function ratioGen() {
    return () => {
      const b = pick([2, 4, 5, 8, 10, 20, 25]), a = ri(1, b - 1);
      return { promptHtml: expr(`<span class="t">기준량 ${b} 에 대한 ${a} 의 비율</span>` + OP("=") + B(0)), blanks: [trimNum((a / b).toFixed(4))] };
    };
  }
  // 백분율(정수 %)
  function percentGen() {
    return () => {
      const b = pick([2, 4, 5, 10, 20, 25, 50]);
      let a; do { a = ri(1, b - 1); } while ((a * 100) % b !== 0);
      return { promptHtml: expr(`<span class="t">${a} 는 ${b} 의</span>` + B(0) + `<span class="t">%</span>`), blanks: [String((a * 100) / b)] };
    };
  }
  // 부피의 큰 단위 (m³ ↔ cm³)
  function volumeUnitGen() {
    return () => {
      const m = ri(2, 9);
      if (Math.random() < 0.5) {
        return { promptHtml: expr(`<span class="t">${m} m³</span>` + OP("=") + B(0) + `<span class="t">cm³</span>`), blanks: [String(m * 1000000)] };
      }
      return { promptHtml: expr(`<span class="t">${m * 1000000} cm³</span>` + OP("=") + B(0) + `<span class="t">m³</span>`), blanks: [String(m)] };
    };
  }
  // (자연수)÷(단위분수)
  function natDivUnitFracGen() {
    return () => {
      const n = ri(2, 9), d = ri(2, 9);
      return { promptHtml: expr(T(n) + OP("÷") + fr(1, d) + OP("=") + B(0)), blanks: [String(n * d)] };
    };
  }
  // 분모가 같은 진분수끼리의 나눗셈 → 기약분수
  function sameDenFracDivGen() {
    return () => {
      const d = ri(3, 9), a = ri(1, d - 1), b = ri(1, d - 1);
      const g = gcd(a, b) || 1;
      return { promptHtml: expr(fr(a, d) + OP("÷") + fr(b, d) + OP("=") + frB(0, 1)), blanks: [String(a / g), String(b / g)] };
    };
  }
  // (분수)÷(분수) → 기약분수
  function fracDivGen() {
    return () => {
      const b = ri(2, 7), d = ri(2, 7), a = ri(1, b - 1), c = ri(1, d - 1);
      const num = a * d, den = b * c, g = gcd(num, den) || 1;
      return { promptHtml: expr(fr(a, b) + OP("÷") + fr(c, d) + OP("=") + frB(0, 1)), blanks: [String(num / g), String(den / g)] };
    };
  }
  // (자연수)÷(진분수) → 기약분수
  function natDivFracGen() {
    return () => {
      const b = ri(2, 9), a = ri(1, b - 1), n = ri(2, 9);
      const num = n * b, den = a, g = gcd(num, den) || 1;
      return { promptHtml: expr(T(n) + OP("÷") + fr(a, b) + OP("=") + frB(0, 1)), blanks: [String(num / g), String(den / g)] };
    };
  }
  // 대분수의 나눗셈 → 기약분수(가분수 허용)
  function mixedFracDivGen() {
    return () => {
      const d1 = ri(2, 6), d2 = ri(2, 6);
      const w1 = ri(1, 3), n1 = ri(1, d1 - 1), w2 = ri(1, 3), n2 = ri(1, d2 - 1);
      const i1 = w1 * d1 + n1, i2 = w2 * d2 + n2;
      const num = i1 * d2, den = d1 * i2, g = gcd(num, den) || 1;
      return { promptHtml: expr(mixed(w1, n1, d1) + OP("÷") + mixed(w2, n2, d2) + OP("=") + frB(0, 1)), blanks: [String(num / g), String(den / g)] };
    };
  }
  // 소수 ÷ 소수 (나누어떨어지게)
  function decDiv11Gen() { // (소수 한 자리)÷(소수 한 자리), 정수 몫
    return () => {
      const k = ri(11, 49), q = ri(2, 9);
      const v = k / 10, dividend = +(v * q).toFixed(1);
      return { promptHtml: expr(T(dividend.toFixed(1)) + OP("÷") + T(v.toFixed(1)) + OP("=") + B(0)), blanks: [String(q)] };
    };
  }
  function decDiv22Gen() { // (소수 두 자리)÷(소수 두 자리), 정수 몫
    return () => {
      const k = ri(11, 49), q = ri(2, 9);
      const v = k / 100, dividend = +(v * q).toFixed(2);
      return { promptHtml: expr(T(dividend.toFixed(2)) + OP("÷") + T(v.toFixed(2)) + OP("=") + B(0)), blanks: [String(q)] };
    };
  }
  function decDivDiffGen() { // 자릿수가 다른 두 소수의 나눗셈 (피제수 2자리, 제수 1자리)
    return () => {
      const k = ri(2, 9), m = ri(2, 9);
      const v = k / 10, ans = m / 10, dividend = +(v * ans).toFixed(2);
      return { promptHtml: expr(T(dividend.toFixed(2)) + OP("÷") + T(v.toFixed(1)) + OP("=") + B(0)), blanks: [trimNum(ans.toFixed(1))] };
    };
  }
  function decDivMixGen() { // 소수의 나눗셈의 활용 (혼합)
    const gens = [decDiv11Gen(), decDiv22Gen(), decDivDiffGen()];
    return () => pick(gens)();
  }
  // (자연수)÷(소수), 나누어떨어지게
  function natDivDecGen() {
    return () => {
      const vs = [0.2, 0.25, 0.4, 0.5, 0.75, 0.8];
      for (let t = 0; t < 100; t++) {
        const v = pick(vs), ans = ri(2, 40), n = +(ans * v).toFixed(2);
        if (Number.isInteger(n) && n >= 2) return { promptHtml: expr(T(n) + OP("÷") + T(String(v)) + OP("=") + B(0)), blanks: [String(ans)] };
      }
      return { promptHtml: expr(T(10) + OP("÷") + T("0.5") + OP("=") + B(0)), blanks: ["20"] };
    };
  }
  // 나머지가 있는 소수의 나눗셈: (소수)÷(정수) = 몫(정수) … 나머지(소수)
  function decDivRemGen() {
    return () => {
      const divisor = ri(2, 9), q = ri(2, 9), r = ri(1, divisor * 10 - 1) / 10;
      const dividend = +(divisor * q + r).toFixed(1);
      return { promptHtml: expr(T(dividend.toFixed(1)) + OP("÷") + T(divisor) + OP("=") + B(0) + OP("…") + B(1)), blanks: [String(q), trimNum(r.toFixed(1))] };
    };
  }
  // 소수의 몫을 반올림하기
  function decRoundGen() {
    return () => {
      const place = pick([1, 2]);
      const a = +((ri(2, 9) * 10 + ri(1, 9)) / 10).toFixed(1), b = ri(3, 9);
      const factor = Math.pow(10, place);
      const ans = Math.round((a / b) * factor) / factor;
      const label = place === 1 ? "소수 첫째 자리까지" : "소수 둘째 자리까지";
      return { promptHtml: expr(`<span class="t">${a.toFixed(1)} ÷ ${b} 를 반올림하여 ${label}</span>` + OP("=") + B(0)), blanks: [trimNum(ans.toFixed(place))] };
    };
  }
  // 쌓기나무의 개수
  function cubeCountGen() {
    return () => {
      const w = ri(2, 5), d = ri(2, 5), h = ri(2, 5);
      return { promptHtml: expr(`<span class="t">가로 ${w}, 세로 ${d}, 높이 ${h}인 직육면체 모양 쌓기나무의 개수</span>` + OP("=") + B(0)), blanks: [String(w * d * h)] };
    };
  }

  /* ---------- 커리큘럼 카탈로그 (학년군 → 세부항목) ---------- */
  let ivc = 0;
  // I(name, gen) — 항목이 속한 학기는 그룹(GROUPS)으로 구분한다.
  function makeItem(groupId) {
    return (name, gen) => ({ id: "I" + (++ivc), group: groupId, name, gen });
  }

  const I31 = makeItem("g31"), I32 = makeItem("g32"), I41 = makeItem("g41"), I42 = makeItem("g42");
  const I51 = makeItem("g51"), I52 = makeItem("g52"), I61 = makeItem("g61"), I62 = makeItem("g62");
  const GROUPS = [
    {
      id: "g31", label: "3학년 1학기", items: [
        I31("여러 가지 방법으로 덧셈하기", vBinGen("+", (a, b) => a + b, () => ri(102, 898), () => ri(102, 898))),
        I31("(세 자리 수) + (세 자리 수)", vBinGen("+", (a, b) => a + b, () => ri(123, 888), () => ri(123, 888))),
        I31("여러 가지 방법으로 뺄셈하기", vBinGen("−", (a, b) => a - b, () => ri(345, 999), () => ri(112, 344))),
        I31("(세 자리 수) − (세 자리 수)", vBinGen("−", (a, b) => a - b, () => ri(345, 999), () => ri(112, 344))),
        I31("(네 자리 수) − (세 자리 수)", vBinGen("−", (a, b) => a - b, () => ri(1234, 9876), () => ri(234, 987))),
        I31("덧셈과 뺄셈", vAddSubGen(() => ri(123, 888), () => ri(112, 444))),
        I31("나눗셈 - 똑같이 나누기", divExactGen(() => ri(2, 9), () => ri(1, 9))),
        I31("곱셈구구와 나눗셈", divExactGen(() => ri(2, 9), () => ri(2, 9))),
        I31("나눗셈과 곱셈", divExactGen(() => ri(2, 9), () => ri(2, 9))),
        I31("나눗셈", divExactGen(() => ri(2, 9), () => ri(2, 9))),
        I31("곱셈구구 복습", () => timesTableGen(ri(2, 9))()),
        I31("(몇십) × (몇)", vMulGen(() => ri(2, 9) * 10, () => ri(2, 9))),
        I31("(두 자리 수) × (한 자리 수)", vMulGen(() => ri(11, 49), () => ri(2, 9))),
        I31("곱셈 종합", () => (Math.random() < 0.5 ? vMulGen(() => ri(2, 9) * 10, () => ri(2, 9)) : vMulGen(() => ri(11, 49), () => ri(2, 9)))()),
        I31("곱셈의 활용", vMulGen(() => ri(12, 49), () => ri(3, 9))),
      ],
    },
    {
      id: "g32", label: "3학년 2학기", items: [
        I32("(세 자리 수) × (한 자리 수)", vMulGen(() => ri(112, 499), () => ri(2, 9))),
        I32("곱셈 종합", () => (Math.random() < 0.5 ? vMulGen(() => ri(112, 499), () => ri(2, 9)) : vMulGen(() => ri(11, 49), () => ri(11, 49)))()),
        I32("(몇십) × (몇십)", vMulGen(() => ri(2, 9) * 10, () => ri(2, 9) * 10)),
        I32("(두 자리 수) × (몇십)", vMulGen(() => ri(11, 49), () => ri(2, 9) * 10)),
        I32("(두 자리 수) × (두 자리 수)", vMulGen(() => ri(11, 49), () => ri(11, 49))),
        I32("곱셈의 활용", vMulGen(() => ri(13, 79), () => ri(12, 49))),
        I32("(몇십) ÷ (몇)", () => {
          const d = ri(2, 4), Q = ri(2, Math.floor(9 / d)), T0 = d * Q;
          return { promptHtml: expr(T(T0 * 10) + OP("÷") + T(d) + OP("=") + B(0)), blanks: [String(Q * 10)] };
        }),
        I32("나머지가 있는 나눗셈", divRemGen(() => ri(3, 9), () => ri(2, 9))),
        I32("나눗셈의 검산", divCheckGen(() => ri(3, 9), () => ri(2, 9), true)),
        I32("(몇십 몇) ÷ (몇)", divExactGen(() => ri(2, 9), () => ri(2, 9))),
        I32("(몇십 몇) ÷ (몇) 나눗셈의 검산", divCheckGen(() => ri(2, 9), () => ri(2, 9), false)),
        I32("대분수를 가분수로, 가분수를 대분수로 나타내기", fracConvertGen()),
        I32("들이의 단위", capacityGen()),
      ],
    },
    {
      id: "g41", label: "4학년 1학기", items: [
        I41("곱셈 종합", () => (Math.random() < 0.5 ? vMulGen(() => ri(112, 499), () => ri(11, 49)) : vMulGen(() => ri(11, 49), () => ri(11, 49)))()),
        I41("몇십으로 나누기", () => {
          const d = ri(2, 9) * 10, q = ri(2, 9);
          return { promptHtml: expr(T(d * q) + OP("÷") + T(d) + OP("=") + B(0)), blanks: [String(q)] };
        }),
        I41("(두 자리 수) ÷ (두 자리 수)", () => {
          const d = ri(11, 24), q = ri(2, Math.max(2, Math.floor(99 / d)));
          return { promptHtml: expr(T(d * q) + OP("÷") + T(d) + OP("=") + B(0)), blanks: [String(q)] };
        }),
        I41("(세 자리 수) ÷ (두 자리 수)", divRemGen(() => ri(11, 40), () => ri(6, 25))),
        I41("나눗셈 종합", () => (Math.random() < 0.5 ? divExactGen(() => ri(11, 24), () => ri(2, 6))() : divRemGen(() => ri(11, 40), () => ri(6, 20))())),
        I41("곱셈 심화", vMulGen(() => ri(112, 899), () => ri(12, 79))),
      ],
    },
    {
      id: "g42", label: "4학년 2학기", items: [
        I42("분모가 같은 진분수의 덧셈", sameDenProperGen(true)),
        I42("분모가 같은 대분수의 덧셈", sameDenMixedGen(true)),
        I42("분모가 같은 진분수의 뺄셈", sameDenProperGen(false)),
        I42("분모가 같은 대분수의 뺄셈", sameDenMixedGen(false)),
        I42("대분수와 진분수의 덧셈과 뺄셈", mixedProperGen()),
        I42("자릿수가 같은 소수의 덧셈", decimalSameGen(true, 1)),
        I42("자릿수가 다른 소수의 덧셈", decimalDiffGen(true)),
        I42("자릿수가 같은 소수의 뺄셈", decimalSameGen(false, 1)),
        I42("자릿수가 다른 소수의 뺄셈", decimalDiffGen(false)),
      ],
    },
    {
      id: "g51", label: "5학년 1학기", items: [
        I51("덧셈과 뺄셈의 혼합 계산", mixedCalcGen(["+", "−"], true)),
        I51("곱셈과 나눗셈의 혼합 계산", mixedCalcGen(["×", "÷"], true)),
        I51("덧셈, 뺄셈, 곱셈의 혼합 계산", mixedCalcGen(["+", "−", "×"], true)),
        I51("덧셈, 뺄셈, 나눗셈의 혼합 계산", mixedCalcGen(["+", "−", "÷"], true)),
        I51("덧셈, 뺄셈, 곱셈, 나눗셈의 혼합 계산", mixedCalcGen(["+", "−", "×", "÷"], true)),
        I51("약수와 배수", gcdLcmGen()),
        I51("약분과 통분", reduceGen()),
        I51("분수와 소수", fracToDecimalGen()),
        I51("분수의 덧셈과 뺄셈", fracAddSubDiffGen()),
      ],
    },
    {
      id: "g52", label: "5학년 2학기", items: [
        I52("분수의 곱셈", fracMulGen()),
        I52("소수와 자연수의 곱셈", decimalNatMulGen()),
        I52("소수의 곱셈", decimalMulGen()),
      ],
    },
    {
      id: "g61", label: "6학년 1학기", items: [
        I61("분수와 자연수의 나눗셈", fracDivNatGen()),
        I61("소수와 자연수의 나눗셈", decimalNatDivGen()),
        I61("비율 구하기", ratioGen()),
        I61("백분율 구하기", percentGen()),
        I61("부피의 큰 단위", volumeUnitGen()),
      ],
    },
    {
      id: "g62", label: "6학년 2학기", items: [
        I62("(자연수) ÷ (단위분수)", natDivUnitFracGen()),
        I62("분모가 같은 진분수끼리의 나눗셈", sameDenFracDivGen()),
        I62("분모가 다른 진분수의 나눗셈", fracDivGen()),
        I62("(자연수) ÷ (진분수)", natDivFracGen()),
        I62("대분수의 나눗셈", mixedFracDivGen()),
        I62("분수의 나눗셈 활용하기", fracDivGen()),
        I62("(소수 한 자리 수) ÷ (소수 한 자리 수)", decDiv11Gen()),
        I62("(소수 두 자리 수) ÷ (소수 두 자리 수)", decDiv22Gen()),
        I62("자릿수가 다른 두 소수의 나눗셈", decDivDiffGen()),
        I62("(자연수) ÷ (소수)", natDivDecGen()),
        I62("나머지가 있는 소수의 나눗셈", decDivRemGen()),
        I62("소수의 몫을 반올림하기", decRoundGen()),
        I62("소수의 나눗셈의 활용", decDivMixGen()),
        I62("쌓기나무의 개수 구하기", cubeCountGen()),
      ],
    },
  ];

  /* ---------- 조회 헬퍼 ---------- */
  function findGroup(gid) { return GROUPS.find((g) => g.id === gid); }
  function findItem(itemId) {
    for (const g of GROUPS) for (const it of g.items) if (it.id === itemId) return { group: g, item: it };
    return null;
  }

  // 문제 세트 생성
  //  - exclude: 이전에 출제된 문제 시그니처(Set). 가능한 한 중복을 피한다.
  //  - 세트 내부 중복도 회피한다.
  function generateSet(itemId, count, exclude) {
    const found = findItem(itemId);
    if (!found) return null;
    exclude = exclude || new Set();
    const out = [];
    const seen = new Set();
    const maxGuard = count * 80;
    const add = (p) => out.push({ id: out.length + 1, promptHtml: p.promptHtml, blanks: p.blanks });

    // 1차: 이전 출제 + 세트 내 중복 모두 회피
    let guard = 0;
    while (out.length < count && guard < maxGuard) {
      guard++;
      const p = found.item.gen();
      if (seen.has(p.promptHtml) || exclude.has(p.promptHtml)) continue;
      seen.add(p.promptHtml); add(p);
    }
    // 2차 완화: 세트 내 중복만 회피 (조합 수가 적은 항목 대비)
    guard = 0;
    while (out.length < count && guard < maxGuard) {
      guard++;
      const p = found.item.gen();
      if (seen.has(p.promptHtml)) continue;
      seen.add(p.promptHtml); add(p);
    }
    // 3차 완화: 무조건 채움
    while (out.length < count) add(found.item.gen());

    out.forEach((p, i) => (p.id = i + 1));
    return out;
  }

  function itemMeta(itemId) {
    const f = findItem(itemId);
    if (!f) return null;
    return {
      groupLabel: f.group.label,
      name: f.item.name,
      title: f.item.name,
    };
  }

  window.Curriculum = { GROUPS, findGroup, findItem, generateSet, itemMeta };
})();
