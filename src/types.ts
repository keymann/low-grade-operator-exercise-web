/**
 * Type definitions for the 일일수학 클론 (math practice) app.
 */

export interface Env {
	/** Binding for the Workers AI API (used for handwriting OCR). */
	AI: Ai;

	/** Binding for static assets. */
	ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/** Request body for the OCR endpoint. */
export interface OcrRequest {
	/** Data URL (image/png;base64,...) of the handwriting canvas. */
	image: string;
}
