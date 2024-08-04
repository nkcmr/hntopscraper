import { Env } from './env';

export async function reportHealthcheck<R = unknown>(env: Env, ctx: ExecutionContext, hcID: string, fn: () => R): Promise<Awaited<R>> {
	await reportStart(env, hcID);
	try {
		const r = await fn();
		ctx.waitUntil(reportFinish(env, hcID));
		return r;
	} catch (e) {
		ctx.waitUntil(reportFailure(env, hcID, `${(e as any).message || e}`));
		throw e;
	}
}

const MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function reliableFetch(env: Env, input: RequestInfo, init?: RequestInit<RequestInitCfProperties>): Promise<boolean> {
	const init2: RequestInit = {
		...(init || {}),
	};
	const headers = new Headers(init?.headers);
	headers.set('User-Agent', `hntopscraper.reliableFetch (${env.CF_VERSION_METADATA.tag}/${env.CF_VERSION_METADATA.timestamp})`);
	init2.headers = headers;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const response = await Promise.race([fetch(input, init2), sleep(2_500)]);
			if (!response) {
				console.log('reliableFetch: timeout');
				// timeout
				continue;
			}
			if (!response.ok) {
				console.log('reliableFetch: non-ok reponse');
				continue;
			}
			return true;
		} catch (e) {
			console.log(`reliableFetch: fetch failure: ${e}`);
		}
	}
	return false;
}

async function reportFinish(env: Env, id: string): Promise<void> {
	const ok = await reliableFetch(env, `https://hc-ping.com/${id}`);
	if (!ok) {
		throw new Error(`healtcheck.io: reportFinish failed`);
	}
}

async function reportStart(env: Env, id: string): Promise<void> {
	const ok = await reliableFetch(env, `https://hc-ping.com/${id}/start`);
	if (!ok) {
		throw new Error(`healtcheck.io: reportStart failed`);
	}
}

async function reportFailure(env: Env, id: string, logs?: string): Promise<void> {
	const init: RequestInit = {};
	if (logs) {
		init.body = JSON.stringify({ logs });
	}
	const ok = await reliableFetch(env, `https://hc-ping.com/${id}/fail`, init);
	if (!ok) {
		throw new Error(`healtcheck.io: reportFailure failed`);
	}
}
