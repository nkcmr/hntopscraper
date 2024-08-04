export interface Env {
	STATE: KVNamespace;
	HEALTHCHECK_IO_ID: string;
	CF_VERSION_METADATA: WorkerVersionMetadata;
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
