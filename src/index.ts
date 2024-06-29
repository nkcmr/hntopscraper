import { Hono } from 'hono';
import { z } from 'zod';
import { MAX_DATA_TTL } from './constants';
import { Env, HonoEnv, currentTime } from './env';
import { HTTPError } from './error';
import { Story, currentTopStories, getStory, setCurrentTopStories, setStory } from './kv';

const svc = new Hono<HonoEnv>({});

svc.get('/top-stories.json', async (c) => {
	const [storyIDs, lastUpdated] = await currentTopStories(c.env.STATE);

	// slightly complex: this basically just loads most of the story data
	// from our KV namespace, but also will try to pull more dynamic data (points,
	// number of comments) from a cached source to keep it somewhat fresh while
	// not being rude to the HN API
	const stories = await Promise.all(
		storyIDs.map(async (id): Promise<Story & StoryStats> => {
			const statsPromise = semiFreshItemStats(c.env.STATE, id);
			const storyPromise = getStory(c.env.STATE, `${id}`);
			const [stats, waitUntilCached] = await statsPromise;
			c.executionCtx.waitUntil(waitUntilCached);
			return {
				...(await storyPromise),
				score: stats.score,
				descendants: stats.descendants,
			};
		})
	);
	return c.json({
		stories,
		when_refreshed: lastUpdated,
	});
});
svc.get('/update', async (c) => {
	let lastUpdated = 0;
	try {
		[, lastUpdated] = await currentTopStories(c.env.STATE);
	} catch {
		// probably never fetched!
	}
	const now = currentTime();
	const timeSinceLastUpdate = now - lastUpdated;
	if (timeSinceLastUpdate <= 600) {
		throw HTTPError.tooManyRequests('last updated quite recently, refusing to update');
	}
	await updateTopStores(c.env);
	return c.json({ ok: true });
});

svc.onError(async (err, c) => {
	console.log(`onError:triggered`, {
		error: err,
	});
	if (err instanceof HTTPError) {
		return c.json(
			{
				error: err.message,
			},
			err.code
		);
	}
	return c.json({ error: 'internal server error' }, 500);
});

const HN_API_BASE_URI = 'https://hacker-news.firebaseio.com';

async function hnTop(): Promise<number[]> {
	const res = await fetch(`${HN_API_BASE_URI}/v0/beststories.json`);
	if (!res.ok) {
		throw new Error(`non-ok response from hn api: ${res.status} ${res.statusText}`);
	}
	const data = await res.json();
	if (!Array.isArray(data) || typeof data[0] !== 'number') {
		throw new Error(`unknown data shape returned from hn api`);
	}
	return data as number[];
}

const hnItemSchema = z.object({
	by: z.string(),
	descendants: z.number().optional(),
	id: z.number(),
	kids: z.array(z.number()).optional(),
	score: z.number(),
	time: z.number(),
	title: z.string(),
	type: z.string(),
	text: z.string().optional(),
	url: z.string().optional(),
	deleted: z.boolean().optional(),
	dead: z.boolean().optional(),
	parent: z.number().optional(),
});

type HNItem = z.infer<typeof hnItemSchema>;

async function hnItem(id: number): Promise<HNItem> {
	const res = await fetch(`${HN_API_BASE_URI}/v0/item/${id}.json`);
	if (!res.ok) {
		throw new Error(`non-ok response from hn api: ${res.status} ${res.statusText}`);
	}
	const data = await res.json();
	const parseResult = hnItemSchema.safeParse(data);
	if (!parseResult.success) {
		throw new Error(`unknown data shape returned from hn api for item (${id}): ${parseResult.error}`);
	}
	return parseResult.data;
}

interface StoryStats {
	score: number;
	descendants: number;
}

async function semiFreshItemStats(ns: KVNamespace, itemID: number): Promise<[StoryStats, Promise<unknown>]> {
	const now = currentTime();
	const key = `item-stats:${itemID}`;
	const cached = await ns.get(key);

	let fallbackStats: StoryStats | null = null;
	if (cached) {
		const { stats, ts } = JSON.parse(cached);
		const age = now - ts;
		const STALE_THRESHOLD = 600; // 10 minutes
		if (age < STALE_THRESHOLD) {
			console.log(`semiFreshItemStats:hit`, { itemID });
			return [stats, Promise.resolve()];
		}
		console.log(`semiFreshItemStats:stale`, { itemID });
		// stale stats are better than no stats
		fallbackStats = stats;
	} else {
		console.log(`semiFreshItemStats:miss`, { itemID });
	}
	try {
		// fresh fetch
		const item = await hnItem(itemID);
		const stats = {
			score: item.score ?? 0,
			descendants: item.descendants ?? 0,
		};
		return [
			stats,
			ns.put(
				key,
				JSON.stringify({
					ts: now,
					stats,
				}),
				{
					// caching for max ttl, so that we can use stale data in the event
					// of not being able to reach the HN api
					expirationTtl: MAX_DATA_TTL,
				}
			),
		];
	} catch (e) {
		if (fallbackStats) {
			return [fallbackStats, Promise.resolve()];
		}
		throw e; // welp... nothing we can do!
	}
}

async function updateTopStores(env: Env): Promise<void> {
	const now = currentTime();
	const DESIRED_NUM_STORIES = 3;
	const goodStories: number[] = [];
	for (let itemID of await hnTop()) {
		const item = await hnItem(itemID);
		if (item.type !== 'story') {
			console.log('skipping item: not story', { title: item.title, type: item.type });
			continue;
		}
		if (item.dead || item.deleted) {
			console.log('skipping item: dead or deleted', { title: item.title });
			continue;
		}
		if (item.title.toLowerCase().startsWith('ask hn:')) {
			console.log('skipping item: ask hn', { title: item.title });
			continue;
		}
		const age = now - item.time;
		const TWO_DAYS_IN_SECONDS = 172800;
		if (age > TWO_DAYS_IN_SECONDS) {
			// top stories can be kept around for up to 4 days i think, this
			// would be too much i think.
			console.log('skipping item: too old', { title: item.title, age });
			// skip items older than 2 days
			continue;
		}
		console.log('this item looks good!', { item });
		await setStory(env.STATE, {
			id: item.id,
			title: item.title,
			by: item.by,
			time: item.time,
		});
		goodStories.push(item.id);
		if (goodStories.length >= DESIRED_NUM_STORIES) {
			break;
		}
	}
	await setCurrentTopStories(env.STATE, goodStories);
}

export default {
	fetch: svc.fetch,
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		await updateTopStores(env);
	},
};
