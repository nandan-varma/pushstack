import { CliError, type Io } from "./io";

export interface RepoRef {
	owner: string;
	name: string;
}

export function parseRepoArg(arg: string): RepoRef {
	const match = arg.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
	if (
		!match ||
		match[1] === "." ||
		match[1] === ".." ||
		match[2] === "." ||
		match[2] === ".."
	) {
		throw new CliError(`expected the "OWNER/REPO" format, got "${arg}"`);
	}
	return { owner: match[1] as string, name: match[2] as string };
}

/** owner/repo (and the host) out of an https or scp-style git URL, with PushStack's `/api/git/` prefix removed. */
function parseRemote(url: string): (RepoRef & { host: string }) | null {
	let host: string;
	let path: string;
	const scp = url.match(/^[^@/]+@([^:/]+):(.+)$/);
	if (scp) {
		host = scp[1] as string;
		path = scp[2] as string;
	} else {
		try {
			const parsed = new URL(url);
			host = parsed.host;
			path = parsed.pathname;
		} catch {
			return null;
		}
	}
	path = path
		.replace(/^\/+/, "")
		.replace(/^api\/git\//, "")
		.replace(/\.git$/, "")
		.replace(/\/+$/, "");
	const parts = path.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	return { host, owner: parts[0], name: parts[1] };
}

/**
 * Which repository a command means, like gh: `-R`, then `PST_REPO`, then the
 * first git remote on `host`.
 */
export async function resolveRepo(
	io: Io,
	host: string,
	flag: string | undefined,
): Promise<RepoRef> {
	const explicit = flag || io.env.PST_REPO;
	if (explicit) return parseRepoArg(explicit);
	for (const url of await io.remotes()) {
		const remote = parseRemote(url);
		if (remote && remote.host === host) return remote;
	}
	throw new CliError(
		`unable to determine the repository: no git remote points at ${host}. Pass OWNER/REPO or use --repo`,
	);
}
