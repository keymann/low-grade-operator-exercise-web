/**
 * Type definitions for the 일일수학 클론 (math practice) app.
 */

export interface Env {
	/** Binding for static assets. */
	ASSETS: { fetch: (request: Request) => Promise<Response> };
}
