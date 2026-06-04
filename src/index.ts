/**
 * 일일수학 클론 — 손글씨 연산 연습 웹앱
 *
 * Cloudflare Worker: 정적 자산(SPA) 서빙만 담당.
 * 손글씨 숫자 인식(OCR)은 클라이언트 측 MNIST 모델(ONNX Runtime Web)로 처리하므로
 * 별도의 서버 추론 엔드포인트가 필요 없다.
 *
 * @license MIT
 */
import { Env } from "./types";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// 모든 경로를 정적 자산(SPA)으로 서빙
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
