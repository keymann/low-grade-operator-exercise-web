/**
 * 일일수학 클론 — 손글씨 연산 연습 웹앱
 *
 * Cloudflare Worker:
 *  - 정적 자산(SPA) 서빙
 *  - POST /api/ocr : 손글씨 캔버스 이미지를 받아 Workers AI 비전 모델로 숫자 인식
 *
 * @license MIT
 */
import { Env, OcrRequest } from "./types";

// 손글씨 숫자 인식에 사용할 비전 모델
// https://developers.cloudflare.com/workers-ai/models/
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

export default {
	async fetch(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/ocr") {
			if (request.method !== "POST") {
				return new Response("Method not allowed", { status: 405 });
			}
			return handleOcr(request, env);
		}

		// 그 외 모든 경로는 정적 자산(SPA)
		if (!url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * 손글씨 이미지를 받아 숫자 문자열로 변환한다.
 * 응답: { digits: string }  (인식 실패 시 빈 문자열)
 */
async function handleOcr(request: Request, env: Env): Promise<Response> {
	try {
		const { image } = (await request.json()) as OcrRequest;
		if (!image || typeof image !== "string") {
			return json({ digits: "", error: "no image" }, 400);
		}

		const bytes = dataUrlToBytes(image);
		if (!bytes) {
			return json({ digits: "", error: "bad image" }, 400);
		}

		const result = (await env.AI.run(VISION_MODEL, {
			image: [...bytes],
			max_tokens: 32,
			messages: [
				{
					role: "system",
					content:
						"You are a strict OCR engine for handwritten digits. " +
						"The image contains one number made of one or more handwritten digits (0-9), " +
						"possibly with a leading minus sign or a decimal point. " +
						"Reply with ONLY that number. No words, no explanation. If unclear, give your best single guess.",
				},
				{
					role: "user",
					content: "What number is written in this image?",
				},
			],
		})) as { response?: string };

		const digits = cleanNumber(result?.response ?? "");
		return json({ digits });
	} catch (err) {
		console.error("OCR error:", err);
		return json({ digits: "", error: "ocr failed" }, 500);
	}
}

/** "data:image/png;base64,XXXX" → Uint8Array */
function dataUrlToBytes(dataUrl: string): Uint8Array | null {
	const comma = dataUrl.indexOf(",");
	const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
	try {
		const binary = atob(b64);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

/** 모델 응답에서 숫자만 추출 (음수/소수점 허용). */
function cleanNumber(text: string): string {
	const match = text.replace(/\s+/g, "").match(/-?\d+(?:\.\d+)?/);
	return match ? match[0] : "";
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
