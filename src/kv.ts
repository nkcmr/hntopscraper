import { MAX_DATA_TTL } from './constants';
import { currentTime } from './env';
import { HTTPError } from './error';

/**
 * @throws HTTPError
 */
export async function currentTopStories(ns: KVNamespace): Promise<[number[], number]> {
	const storyIDsJSON = await ns.get('current-top-stories');
	if (!storyIDsJSON) {
		throw HTTPError.serviceUnavailable('no current top stories');
	}
	return JSON.parse(storyIDsJSON) as [number[], number];
}

export async function setCurrentTopStories(ns: KVNamespace, ids: number[]): Promise<void> {
	await ns.put('current-top-stories', JSON.stringify([ids, currentTime()]));
}

function safeJSONParse(text: string): [any, true] | [null, false] {
	try {
		return [JSON.parse(text), true];
	} catch {
		return [null, false];
	}
}

export interface Story {
	id: number;
	title: string;
	by: string;
	time: number;

	// points extracted in realtime
	// score: number;
	// descendants: number;
}

export async function setStory(ns: KVNamespace, story: Story): Promise<void> {
	const dataJSON = JSON.stringify(story);
	await ns.put(`story:${story.id}`, dataJSON, {
		expirationTtl: MAX_DATA_TTL, // 7 days
	});
}

export async function getStory(ns: KVNamespace, id: string): Promise<Story> {
	const dataJSON = await ns.get(`story:${id}`);
	if (!dataJSON) {
		throw HTTPError.serverError(`story unavailable`);
	}
	const [data, ok] = safeJSONParse(dataJSON);
	if (!ok) {
		throw HTTPError.serverError(`corrupt story data`);
	}
	return data as Story;
}
