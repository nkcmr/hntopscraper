import { StatusCode } from 'hono/utils/http-status';

export class HTTPError extends Error {
	private constructor(message: string, public readonly code: StatusCode) {
		super(message);
	}
	static tooManyRequests(message: string): HTTPError {
		return new HTTPError(message, 429);
	}
	static serverError(message: string): HTTPError {
		return new HTTPError(message, 500);
	}
	static serviceUnavailable(message: string): HTTPError {
		return new HTTPError(message, 503);
	}
	static notFound(message: string): HTTPError {
		return new HTTPError(message, 404);
	}
	static badInput(message: string): HTTPError {
		return new HTTPError(message, 400);
	}
	static unauthenticated(message: string): HTTPError {
		return new HTTPError(message, 401);
	}
}
