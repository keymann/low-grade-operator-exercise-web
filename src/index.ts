/**
 * 일일수학 클론 — 연산 연습 웹앱
 *
 * Cloudflare Worker:
 *  - `/api/state` : 앱 상태(출제/스케줄/정답/제출기록 등)를 KV에 저장/조회.
 *                   여러 브라우저에서 동일한 상태를 공유하기 위한 단일 문서 저장소.
 *  - 그 외 경로   : 정적 자산(SPA) 서빙.
 *
 * @license MIT
 */
import { Env } from "./types";

const STATE_KEY = "state";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/api/state") {
			return handleState(request, env);
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;

async function handleState(request: Request, env: Env): Promise<Response> {
	const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

	if (request.method === "GET") {
		const raw = await env.STATE.get(STATE_KEY);
		return new Response(raw ?? "{}", { headers });
	}

	if (request.method === "PUT" || request.method === "POST") {
		const body = await request.text();
		// 유효한 JSON 인지 가볍게 검증 후 저장
		try {
			JSON.parse(body);
		} catch {
			return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers });
		}
		await env.STATE.put(STATE_KEY, body);
		return new Response(JSON.stringify({ ok: true }), { headers });
	}

	return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers });
}
