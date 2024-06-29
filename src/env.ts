export interface Env {
	STATE: KVNamespace;
	[x: string]: unknown;
}

export type AppVariables = {};

export interface HonoEnv {
	Bindings: Env;
	Variables: AppVariables;
}

export function currentTime(): number {
	return Math.floor(Date.now() / 1000);
}
