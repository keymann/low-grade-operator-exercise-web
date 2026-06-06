/**
 * 일일수학 클론 — 연산 연습 웹앱 (회원제)
 *
 * Cloudflare Worker API:
 *  - `POST /api/signup` : 회원 가입(초대코드 검증) → 토큰 발급
 *  - `POST /api/login`  : 로그인 → 토큰 발급
 *  - `GET/PUT /api/state?u=<id>&t=<token>` : 회원별 앱 상태 조회/저장
 *  - 그 외 경로 : 정적 자산(SPA) 서빙
 *
 * 저장(KV):
 *  - `user:<id>`  = { id, pwHash, createdAt }   (로그인 비밀번호 SHA-256 해시)
 *  - `state:<id>` = 회원별 상태(부모암호/스케줄/출제/제출기록 등)
 *  - legacy `state` 는 최초 1회 `state:시현엄마` 로 마이그레이션
 *
 * @license MIT
 */
import { Env } from "./types";

const SECRET = "ilmath::v1::secret-salt";   // 해시/토큰 서명용 상수
const INVITE_CODE = "hellow~!!!";
const ID_RE = /^[가-힣a-zA-Z0-9]{1,10}$/;
const LEGACY_USER = "시현엄마";
const LEGACY_PW = "kw20021163";

const json = (obj: unknown, status = 200) =>
	new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const userKey = (id: string) => "user:" + id;
const stateKey = (id: string) => "state:" + id;
const defaultState = (parentPw: string) =>
	JSON.stringify({ password: parentPw, schedule: {}, scheduleOverrides: {}, assignment: null, issued: [], history: [] });

async function sha256hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const hashPw = (pw: string) => sha256hex("pw:" + SECRET + ":" + pw);
const tokenFor = (id: string, pwHash: string) => sha256hex("tok:" + SECRET + ":" + id + ":" + pwHash);

interface UserRecord { id: string; pwHash: string; createdAt: string; }
async function getUser(env: Env, id: string): Promise<UserRecord | null> {
	const raw = await env.STATE.get(userKey(id));
	return raw ? (JSON.parse(raw) as UserRecord) : null;
}

// 기존 단일 상태(legacy `state`)를 시현엄마 계정으로 1회 이관. 멱등.
async function ensureMigration(env: Env): Promise<void> {
	if (await env.STATE.get(userKey(LEGACY_USER))) return;
	const pwHash = await hashPw(LEGACY_PW);
	await env.STATE.put(userKey(LEGACY_USER), JSON.stringify({ id: LEGACY_USER, pwHash, createdAt: new Date().toISOString() }));
	if (!(await env.STATE.get(stateKey(LEGACY_USER)))) {
		const legacy = await env.STATE.get("state");
		await env.STATE.put(stateKey(LEGACY_USER), legacy ?? defaultState(LEGACY_PW));
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		switch (url.pathname) {
			case "/api/signup": return handleSignup(request, env);
			case "/api/login": return handleLogin(request, env);
			case "/api/change-password": return handleChangePassword(request, env);
			case "/api/state": return handleState(request, env, url);
			default: return env.ASSETS.fetch(request);
		}
	},
} satisfies ExportedHandler<Env>;

async function handleSignup(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "method" }, 405);
	await ensureMigration(env);
	let body: any;
	try { body = await request.json(); } catch { return json({ error: "bad" }, 400); }
	const id = String(body.id ?? "").trim();
	const password = String(body.password ?? "");
	const password2 = String(body.password2 ?? "");
	const invite = String(body.invite ?? "");

	if (invite !== INVITE_CODE) return json({ error: "invite" }, 400);
	if (!ID_RE.test(id)) return json({ error: "id_format" }, 400);
	if (!password || password !== password2) return json({ error: "pw_mismatch" }, 400);
	if (await getUser(env, id)) return json({ error: "dup" }, 409);

	const pwHash = await hashPw(password);
	await env.STATE.put(userKey(id), JSON.stringify({ id, pwHash, createdAt: new Date().toISOString() }));
	await env.STATE.put(stateKey(id), defaultState(password)); // 부모암호 기본값 = 가입 비밀번호
	return json({ ok: true, id, token: await tokenFor(id, pwHash) });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "method" }, 405);
	await ensureMigration(env);
	let body: any;
	try { body = await request.json(); } catch { return json({ error: "bad" }, 400); }
	const id = String(body.id ?? "").trim();
	const password = String(body.password ?? "");

	const user = await getUser(env, id);
	if (!user) return json({ error: "auth" }, 401);
	if ((await hashPw(password)) !== user.pwHash) return json({ error: "auth" }, 401);
	return json({ ok: true, id, token: await tokenFor(id, user.pwHash) });
}

// 로그인 비밀번호 변경: 현재 비밀번호 검증 → 새 해시 저장 → 새 토큰 반환
async function handleChangePassword(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "method" }, 405);
	let body: any;
	try { body = await request.json(); } catch { return json({ error: "bad" }, 400); }
	const id = String(body.id ?? "").trim();
	const current = String(body.current ?? "");
	const next = String(body.next ?? body.new ?? "");

	const user = await getUser(env, id);
	if (!user || (await hashPw(current)) !== user.pwHash) return json({ error: "auth" }, 401);
	if (next.length < 4) return json({ error: "weak" }, 400);

	const pwHash = await hashPw(next);
	await env.STATE.put(userKey(id), JSON.stringify({ ...user, pwHash }));
	return json({ ok: true, id, token: await tokenFor(id, pwHash) });
}

async function handleState(request: Request, env: Env, url: URL): Promise<Response> {
	await ensureMigration(env);
	const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
	const id = (url.searchParams.get("u") || "").trim();
	const token = url.searchParams.get("t") || "";

	const user = id ? await getUser(env, id) : null;
	if (!user || !token || (await tokenFor(id, user.pwHash)) !== token) {
		return json({ error: "auth" }, 401);
	}

	if (request.method === "GET") {
		const raw = await env.STATE.get(stateKey(id));
		return new Response(raw ?? defaultState(""), { headers });
	}
	if (request.method === "PUT" || request.method === "POST") {
		const bodyText = await request.text();
		try { JSON.parse(bodyText); } catch { return json({ error: "invalid json" }, 400); }
		await env.STATE.put(stateKey(id), bodyText);
		return json({ ok: true });
	}
	return json({ error: "method" }, 405);
}
