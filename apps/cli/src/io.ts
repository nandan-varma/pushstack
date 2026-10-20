/** Everything the commands touch outside the process, injected so tests can fake it. */
export interface Io {
	stdout(text: string): void;
	stderr(text: string): void;
	readStdin(): Promise<string>;
	env: Record<string, string | undefined>;
	fetch: typeof fetch;
	configDir: string;
	/** Fetch URLs of the current directory's git remotes, `origin` first. Empty outside a repository. */
	remotes(): Promise<string[]>;
	isTTY: boolean;
	/** Runs git in the current directory; resolves stdout, rejects on a nonzero exit. */
	git?(args: string[]): Promise<string>;
}

/** A failure to report as `pst: <message>` with an exit code. */
export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode = 1,
	) {
		super(message);
	}
}

/** gh's exit code for "authentication required". */
export const EXIT_AUTH = 4;
