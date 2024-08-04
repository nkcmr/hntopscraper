export async function reportHealthcheck<R = unknown>(ctx: ExecutionContext, hcID: string, fn: () => R): Promise<Awaited<R>> {
	await reportStart(hcID);
	try {
		const r = await fn();
		ctx.waitUntil(reportFinish(hcID));
		return r;
	} catch (e) {
		ctx.waitUntil(reportFailure(hcID, `${(e as any).message || e}`));
		throw e;
	}
}

const MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function reliableFetch(input: RequestInfo, init?: RequestInit<RequestInitCfProperties>): Promise<boolean> {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const response = await Promise.race([fetch(input, init), sleep(2_500)]);
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

async function reportFinish(id: string): Promise<void> {
	const ok = await reliableFetch(`https://hc-ping.com/${id}`);
	if (!ok) {
		throw new Error(`healtcheck.io: reportFinish failed`);
	}
}

async function reportStart(id: string): Promise<void> {
	const ok = await reliableFetch(`https://hc-ping.com/${id}/start`);
	if (!ok) {
		throw new Error(`healtcheck.io: reportStart failed`);
	}
}

async function reportFailure(id: string, logs?: string): Promise<void> {
	const init: RequestInit = {};
	if (logs) {
		init.body = JSON.stringify({ logs });
	}
	const ok = await reliableFetch(`https://hc-ping.com/${id}/fail`, init);
	if (!ok) {
		throw new Error(`healtcheck.io: reportFailure failed`);
	}
}
