/**
 * openpgp is ~825 KB and costs ~18 ms of module init, and only signature
 * verification and GPG key parsing need it. Loading it here on first use keeps
 * that work out of every cold start that never verifies anything — the same
 * pattern `perf-log.ts` uses for Sentry. Memoized, so the import happens at
 * most once per process.
 */
export type OpenPgp = typeof import("openpgp");

let loaded: Promise<OpenPgp> | null = null;

export function openpgp(): Promise<OpenPgp> {
	if (!loaded) loaded = import("openpgp");
	return loaded;
}
