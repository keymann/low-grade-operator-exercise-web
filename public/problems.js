/*
 * problems.js — 일일수학 커리큘럼 카탈로그 + 문제 생성기
 *
 * 문제 모델:
 *   { promptHtml: string, blanks: string[] }
 *   - promptHtml 안의 빈칸은 <span class="blank" data-bi="N"> 로 표시
 *   - blanks[N] 은 N번 빈칸의 정답 문자열
 *
 * 커리큘럼: GRADES[] → grade.units[] → unit.levels[]
 *   level = { id, name, gen() }  ( gen 은 문제 모델을 반환 )
 */
(function () {
  "use strict";

  /* ---------- 유틸 ---------- */
  const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
  function lcm(a, b) { return (a / gcd(a, b)) * b; }

  /* ---------- 렌더 헬퍼 (HTML 문자열) ---------- */
  const T = (s) => `<span class="t">${s}</span>`;
  const OP = (s) => `<span class="op">${s}</span>`;
  const B = (i) => `<span class="blank" data-bi="${i}" tabindex="0" role="button" aria-label="답 입력"></span>`;
  const fr = (n, d) => `<span class="frac"><span class="fn">${n}</span><span class="fl"></span><span class="fd">${d}</span></span>`;
  const frB = (ni, di) => `<span class="frac"><span class="fn">${B(ni)}</span><span class="fl"></span><span class="fd">${B(di)}</span></span>`;
  // 대분수: 정수부 + 분수
  const mixed = (w, n, d) => `<span class="mixed">${T(w)}${fr(n, d)}</span>`;
  const expr = (inner) => `<span class="expr">${inner}</span>`;

  /* ---------- 공용 생성기 빌더 ---------- */
  // a (op) b = ☐
  function binGen(opSym, fn, genA, genB) {
    return () => {
      let a = genA(), b = genB();
      let ans = fn(a, b);
      // 뺄셈/나눗셈에서 음수/소수 방지
      if (ans < 0) { [a, b] = [b, a]; ans = fn(a, b); }
      return { promptHtml: expr(T(a) + OP(opSym) + T(b) + OP("=") + B(0)), blanks: [String(ans)] };
    };
  }
  // ☐ 자리를 랜덤 위치에 둔 덧셈/뺄셈 (□ 안의 수 찾기)
  function missingGen(opSym, maxA, maxB) {
    return () => {
      const a = ri(1, maxA), b = ri(1, maxB);
      const c = opSym === "+" ? a + b : a + b; // 항상 a (op) b = c 형태로 보장
      const sum = a + b;
      // a + ☐ = sum  또는  ☐ + b = sum
      if (Math.random() < 0.5) {
        return { promptHtml: expr(T(a) + OP("+") + B(0) + OP("=") + T(sum)), blanks: [String(b)] };
      }
      return { promptHtml: expr(B(0) + OP("+") + T(b) + OP("=") + T(sum)), blanks: [String(a)] };
    };
  }
  // 세 수의 계산: a (op) b (op) c = ☐
  function threeGen(maxStep) {
    return () => {
      const ops = [pick(["+", "-"]), pick(["+", "-"])];
      let a = ri(2, maxStep), cur = a, html = T(a);
      const seq = [a];
      for (const o of ops) {
        let n;
        if (o === "-") { n = ri(1, cur); cur -= n; } else { n = ri(1, maxStep); cur += n; }
        html += OP(o) + T(n);
        seq.push(n);
      }
      return { promptHtml: expr(html + OP("=") + B(0)), blanks: [String(cur)] };
    };
  }
  // 곱셈구구 단별
  function timesTableGen(table) {
    return () => {
      const b = ri(1, 9);
      const [x, y] = Math.random() < 0.5 ? [table, b] : [b, table];
      return { promptHtml: expr(T(x) + OP("×") + T(y) + OP("=") + B(0)), blanks: [String(x * y)] };
    };
  }
  // 일반 곱셈 (자릿수 지정)
  function mulGen(aMin, aMax, bMin, bMax) {
    return () => {
      const a = ri(aMin, aMax), b = ri(bMin, bMax);
      return { promptHtml: expr(T(a) + OP("×") + T(b) + OP("=") + B(0)), blanks: [String(a * b)] };
    };
  }
  // 나눗셈 (나머지 없음)
  function divExactGen(divMax, quoMax) {
    return () => {
      const d = ri(2, divMax), q = ri(1, quoMax);
      return { promptHtml: expr(T(d * q) + OP("÷") + T(d) + OP("=") + B(0)), blanks: [String(q)] };
    };
  }
  // 나눗셈 (몫과 나머지) → 빈칸 2개
  function divRemGen(divMax, quoMax) {
    return () => {
      const d = ri(2, divMax), q = ri(2, quoMax), r = ri(1, d - 1);
      const dividend = d * q + r;
      return {
        promptHtml: expr(T(dividend) + OP("÷") + T(d) + OP("=") + B(0) + OP("…") + B(1)),
        blanks: [String(q), String(r)],
      };
    };
  }

  /* ---------- 분수/소수 생성기 ---------- */
  // 동분모 분수 덧셈/뺄셈 → 기약분수로
  function fracSameDenGen(isAdd) {
    return () => {
      const d = ri(3, 12);
      let n1 = ri(1, d - 1), n2 = ri(1, d - 1);
      let num = isAdd ? n1 + n2 : Math.abs(n1 - n2);
      if (!isAdd && n1 < n2) [n1, n2] = [n2, n1], num = n1 - n2;
      if (num === 0) num = 1;
      // 기약분수
      const g = gcd(num, d) || 1;
      const rn = num / g, rd = d / g;
      const left = fr(n1, d) + OP(isAdd ? "+" : "−") + fr(n2, d);
      return { promptHtml: expr(left + OP("=") + frB(0, 1)), blanks: [String(rn), String(rd)] };
    };
  }
  // 약분 → 기약분수
  function reduceGen() {
    return () => {
      const g = ri(2, 9);
      let rn = ri(1, 6), rd = ri(2, 9);
      while (gcd(rn, rd) !== 1 || rn >= rd) { rn = ri(1, 6); rd = ri(2, 9); }
      return { promptHtml: expr(fr(rn * g, rd * g) + OP("=") + frB(0, 1)), blanks: [String(rn), String(rd)] };
    };
  }
  // 통분 (최소공배수를 공통분모로) → 빈칸 4개
  function commonDenomGen() {
    return () => {
      let d1 = ri(2, 9), d2 = ri(2, 9);
      while (d1 === d2 || lcm(d1, d2) > 60) { d1 = ri(2, 9); d2 = ri(2, 9); }
      const n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1);
      const L = lcm(d1, d2);
      const a1 = n1 * (L / d1), a2 = n2 * (L / d2);
      const left = `<span class="t">(</span>` + fr(n1, d1) + OP(",") + fr(n2, d2) + `<span class="t">)</span>`;
      const right = `<span class="t">(</span>` + frB(0, 1) + OP(",") + frB(2, 3) + `<span class="t">)</span>`;
      return {
        promptHtml: expr(left + OP("→") + right),
        blanks: [String(a1), String(L), String(a2), String(L)],
      };
    };
  }
  // 이분모 분수 덧셈/뺄셈 → 기약분수
  function fracDiffDenGen(isAdd) {
    return () => {
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
      const left = fr(n1, d1) + OP("×") + fr(n2, d2);
      return { promptHtml: expr(left + OP("=") + frB(0, 1)), blanks: [String(num / g), String(den / g)] };
    };
  }
  // 분수의 나눗셈 → 기약분수
  function fracDivGen() {
    return () => {
      const d1 = ri(2, 7), d2 = ri(2, 7);
      const n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1);
      const num = n1 * d2, den = d1 * n2, g = gcd(num, den) || 1;
      const left = fr(n1, d1) + OP("÷") + fr(n2, d2);
      return { promptHtml: expr(left + OP("=") + frB(0, 1)), blanks: [String(num / g), String(den / g)] };
    };
  }
  // 소수 덧셈/뺄셈
  function decimalAddSubGen(isAdd, places) {
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
  // 소수 곱셈
  function decimalMulGen() {
    return () => {
      const a = ri(11, 99) / 10, b = ri(2, 9);
      const ans = +(a * b).toFixed(1);
      return { promptHtml: expr(T(a.toFixed(1)) + OP("×") + T(b) + OP("=") + B(0)), blanks: [trimNum(ans.toFixed(2))] };
    };
  }
  // 소수 나눗셈 (나누어 떨어지게)
  function decimalDivGen() {
    return () => {
      const q = ri(11, 99) / 10, d = ri(2, 9);
      const dividend = +(q * d).toFixed(1);
      return { promptHtml: expr(T(dividend.toFixed(1)) + OP("÷") + T(d) + OP("=") + B(0)), blanks: [trimNum(q.toFixed(2))] };
    };
  }
  function trimNum(s) { return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s; }

  // 약수와 배수: 최대공약수 / 최소공배수
  function gcdLcmGen(wantLcm) {
    return () => {
      const a = ri(4, 24), b = ri(4, 24);
      const ans = wantLcm ? lcm(a, b) : gcd(a, b);
      const label = wantLcm ? "최소공배수" : "최대공약수";
      return { promptHtml: expr(`<span class="t">${a}, ${b} 의 ${label}</span>` + OP("=") + B(0)), blanks: [String(ans)] };
    };
  }
  // 가르기/모으기
  function decomposeGen(maxSum) {
    return () => {
      const whole = ri(2, maxSum), a = ri(1, whole - 1);
      return { promptHtml: expr(`<span class="t">${whole} 은 ${a} 와</span>` + B(0)), blanks: [String(whole - a)] };
    };
  }
  function composeGen(maxSum) {
    return () => {
      const a = ri(1, maxSum - 1), b = ri(1, maxSum - a);
      return { promptHtml: expr(`<span class="t">${a} 와 ${b} 를 모으면</span>` + B(0)), blanks: [String(a + b)] };
    };
  }

  /* ---------- 커리큘럼 카탈로그 ---------- */
  let lvc = 0;
  const L = (name, gen) => ({ id: "L" + (++lvc), name, gen });

  const GRADES = [
    {
      id: "1", label: "1학년",
      units: [
        {
          sem: "1학기", name: "3. 덧셈과 뺄셈", levels: [
            L("두 수로 가르기 (한 자리)", decomposeGen(9)),
            L("두 수를 모으기 (한 자리)", composeGen(9)),
            L("몇 + 몇 (합이 9 이하)", binGen("+", (a, b) => a + b, () => ri(1, 8), () => ri(1, 8))),
            L("몇 − 몇 (차가 9 이하)", binGen("−", (a, b) => a - b, () => ri(2, 9), () => ri(1, 8))),
            L("□ 안의 수 찾기", missingGen("+", 8, 8)),
          ],
        },
        {
          sem: "2학기", name: "2. 덧셈과 뺄셈(1)", levels: [
            L("(몇십) + (몇)", binGen("+", (a, b) => a + b, () => ri(1, 9) * 10, () => ri(1, 9))),
            L("받아올림 없는 (두 자리) + (한 자리)", binGen("+", (a, b) => a + b, () => ri(11, 88), () => ri(1, 9))),
            L("받아내림 없는 (두 자리) − (한 자리)", binGen("−", (a, b) => a - b, () => ri(21, 99), () => ri(1, 8))),
          ],
        },
        {
          sem: "2학기", name: "4. 덧셈과 뺄셈(2)", levels: [
            L("10 모으기와 가르기", composeGen(10)),
            L("10이 되는 더하기", binGen("+", (a, b) => a + b, () => ri(1, 9), () => ri(1, 9))),
            L("10에서 빼기", binGen("−", (a, b) => a - b, () => 10, () => ri(1, 9))),
          ],
        },
        {
          sem: "2학기", name: "6. 덧셈과 뺄셈(3)", levels: [
            L("받아올림 있는 (한 자리) + (한 자리)", binGen("+", (a, b) => a + b, () => ri(5, 9), () => ri(5, 9))),
            L("받아내림 있는 (십몇) − (몇)", binGen("−", (a, b) => a - b, () => ri(11, 18), () => ri(3, 9))),
            L("세 수의 덧셈과 뺄셈", threeGen(8)),
          ],
        },
      ],
    },
    {
      id: "2", label: "2학년",
      units: [
        {
          sem: "1학기", name: "3. 덧셈과 뺄셈", levels: [
            L("받아올림 있는 (두 자리) + (두 자리)", binGen("+", (a, b) => a + b, () => ri(15, 89), () => ri(15, 89))),
            L("받아내림 있는 (두 자리) − (두 자리)", binGen("−", (a, b) => a - b, () => ri(31, 99), () => ri(13, 29))),
            L("세 수의 계산", threeGen(40)),
          ],
        },
        {
          sem: "2학기", name: "2. 곱셈구구", levels: [
            L("2단 곱셈구구", timesTableGen(2)),
            L("3단 곱셈구구", timesTableGen(3)),
            L("4단 곱셈구구", timesTableGen(4)),
            L("5단 곱셈구구", timesTableGen(5)),
            L("6단 곱셈구구", timesTableGen(6)),
            L("7단 곱셈구구", timesTableGen(7)),
            L("8단 곱셈구구", timesTableGen(8)),
            L("9단 곱셈구구", timesTableGen(9)),
            L("곱셈구구 (섞어서)", () => timesTableGen(ri(2, 9))()),
          ],
        },
      ],
    },
    {
      id: "3", label: "3학년",
      units: [
        {
          sem: "1학기", name: "1. 덧셈과 뺄셈", levels: [
            L("(세 자리) + (세 자리)", binGen("+", (a, b) => a + b, () => ri(123, 888), () => ri(123, 888))),
            L("(세 자리) − (세 자리)", binGen("−", (a, b) => a - b, () => ri(345, 999), () => ri(112, 344))),
          ],
        },
        {
          sem: "1학기", name: "3. 나눗셈", levels: [
            L("곱셈구구 범위의 나눗셈", divExactGen(9, 9)),
            L("나머지가 있는 나눗셈", divRemGen(9, 9)),
          ],
        },
        {
          sem: "1학기", name: "4. 곱셈", levels: [
            L("(두 자리) × (한 자리)", mulGen(11, 49, 2, 9)),
            L("(세 자리) × (한 자리)", mulGen(111, 499, 2, 9)),
          ],
        },
        {
          sem: "2학기", name: "1. 곱셈", levels: [
            L("(두 자리) × (두 자리)", mulGen(11, 49, 11, 49)),
          ],
        },
        {
          sem: "2학기", name: "2. 나눗셈", levels: [
            L("(두 자리) ÷ (한 자리)", divExactGen(9, 12)),
            L("나머지가 있는 (두 자리) ÷ (한 자리)", divRemGen(9, 12)),
          ],
        },
        {
          sem: "2학기", name: "4. 분수", levels: [
            L("동분모 분수의 덧셈", fracSameDenGen(true)),
            L("동분모 분수의 뺄셈", fracSameDenGen(false)),
          ],
        },
      ],
    },
    {
      id: "4", label: "4학년",
      units: [
        {
          sem: "1학기", name: "3. 곱셈과 나눗셈", levels: [
            L("(세 자리) × (두 자리)", mulGen(111, 499, 11, 49)),
            L("(세 자리) ÷ (두 자리)", divRemGen(29, 30)),
          ],
        },
        {
          sem: "2학기", name: "1. 분수의 덧셈과 뺄셈", levels: [
            L("동분모 분수의 덧셈", fracSameDenGen(true)),
            L("동분모 분수의 뺄셈", fracSameDenGen(false)),
          ],
        },
        {
          sem: "2학기", name: "3. 소수의 덧셈과 뺄셈", levels: [
            L("소수 한 자리 수의 덧셈", decimalAddSubGen(true, 1)),
            L("소수 한 자리 수의 뺄셈", decimalAddSubGen(false, 1)),
            L("소수 두 자리 수의 덧셈", decimalAddSubGen(true, 2)),
          ],
        },
      ],
    },
    {
      id: "5", label: "5학년",
      units: [
        {
          sem: "1학기", name: "2. 약수와 배수", levels: [
            L("최대공약수 구하기", gcdLcmGen(false)),
            L("최소공배수 구하기", gcdLcmGen(true)),
          ],
        },
        {
          sem: "1학기", name: "4. 약분과 통분", levels: [
            L("약분 (기약분수로)", reduceGen()),
            L("통분 (최소공배수를 공통분모로)", commonDenomGen()),
          ],
        },
        {
          sem: "2학기", name: "1. 분수의 덧셈과 뺄셈", levels: [
            L("이분모 분수의 덧셈", fracDiffDenGen(true)),
            L("이분모 분수의 뺄셈", fracDiffDenGen(false)),
          ],
        },
        {
          sem: "2학기", name: "4. 분수의 곱셈", levels: [
            L("(분수) × (분수)", fracMulGen()),
          ],
        },
        {
          sem: "2학기", name: "5. 소수의 곱셈", levels: [
            L("(소수) × (자연수)", decimalMulGen()),
          ],
        },
      ],
    },
    {
      id: "6", label: "6학년",
      units: [
        {
          sem: "1학기", name: "1. 분수의 나눗셈", levels: [
            L("(분수) ÷ (분수)", fracDivGen()),
          ],
        },
        {
          sem: "1학기", name: "3. 소수의 나눗셈", levels: [
            L("(소수) ÷ (자연수)", decimalDivGen()),
          ],
        },
        {
          sem: "2학기", name: "4. 비와 비율", levels: [
            L("비율을 분수로 나타내기", () => {
              const d = ri(2, 9), n = ri(1, d - 1);
              return { promptHtml: expr(`<span class="t">${n} : ${d} 을 분수로</span>` + OP("=") + frB(0, 1)), blanks: [String(n), String(d)] };
            }),
          ],
        },
      ],
    },
  ];

  /* ---------- 조회 헬퍼 ---------- */
  function findGrade(gid) { return GRADES.find((g) => g.id === gid); }
  function findLevel(levelId) {
    for (const g of GRADES) for (const u of g.units) for (const l of u.levels) if (l.id === levelId) return { grade: g, unit: u, level: l };
    return null;
  }

  // 문제 세트 생성
  //  - exclude: 이전에 출제된 문제 시그니처(Set). 가능한 한 중복을 피한다.
  //  - 세트 내부 중복도 회피한다.
  function generateSet(levelId, count, exclude) {
    const found = findLevel(levelId);
    if (!found) return null;
    exclude = exclude || new Set();
    const out = [];
    const seen = new Set();
    const maxGuard = count * 60;
    const add = (p) => out.push({ id: out.length + 1, promptHtml: p.promptHtml, blanks: p.blanks });

    // 1차: 이전 출제 + 세트 내 중복 모두 회피
    let guard = 0;
    while (out.length < count && guard < maxGuard) {
      guard++;
      const p = found.level.gen();
      if (seen.has(p.promptHtml) || exclude.has(p.promptHtml)) continue;
      seen.add(p.promptHtml); add(p);
    }
    // 2차 완화: 이전 출제 중복은 허용(문제 풀이 가짓수가 적은 단계 대비), 세트 내 중복만 회피
    guard = 0;
    while (out.length < count && guard < maxGuard) {
      guard++;
      const p = found.level.gen();
      if (seen.has(p.promptHtml)) continue;
      seen.add(p.promptHtml); add(p);
    }
    // 3차 완화: 무조건 채움
    while (out.length < count) add(found.level.gen());

    out.forEach((p, i) => (p.id = i + 1));
    return out;
  }

  function levelMeta(levelId) {
    const f = findLevel(levelId);
    if (!f) return null;
    return {
      gradeLabel: f.grade.label,
      sem: f.unit.sem,
      unit: f.unit.name,
      level: f.level.name,
      title: f.level.name,
    };
  }

  window.Curriculum = { GRADES, findGrade, findLevel, generateSet, levelMeta };
})();
