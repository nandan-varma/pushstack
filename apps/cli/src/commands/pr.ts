import { readFile } from "node:fs/promises";
import { parse, pickFields } from "../args";
import { type Client, connect, nextLink } from "../client";
import { resolveHost } from "../config";
import { CliError, type Io } from "../io";
import { resolveRepo } from "../repo-resolve";

interface Side {
	ref: string;
	sha: string;
	repo?: { clone_url?: string } | null;
}
interface Pull {
	number: number;
	title: string;
	body: string | null;
	state: string;
	html_url: string;
	user: { login: string };
	head: Side;
	base: Side;
	draft?: boolean;
	merged?: boolean;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	merged_at: string | null;
}
/** gh's `state`: OPEN, CLOSED or MERGED. */
const stateOf = (p: Pull) => (p.merged_at ? "MERGED" : p.state.toUpperCase());
const JSON_FIELDS = {
	number: (p: Pull) => p.number,
	title: (p: Pull) => p.title,
	body: (p: Pull) => p.body ?? "",
	state: stateOf,
	url: (p: Pull) => p.html_url,
	author: (p: Pull) => ({ login: p.user.login }),
	headRefName: (p: Pull) => p.head.ref,
	headRefOid: (p: Pull) => p.head.sha,
	baseRefName: (p: Pull) => p.base.ref,
	baseRefOid: (p: Pull) => p.base.sha,
	isDraft: (p: Pull) => p.draft ?? false,
	createdAt: (p: Pull) => p.created_at,
	updatedAt: (p: Pull) => p.updated_at,
	closedAt: (p: Pull) => p.closed_at,
	mergedAt: (p: Pull) => p.merged_at,
};
const common = {
	help: { type: "boolean", short: "h" },
	hostname: { type: "string" },
	repo: { type: "string", short: "R" },
} as const;
const TARGET = "[<number> | <branch>]";
const HELP: Record<string, string> = {
	list: "pst pr list [--repo OWNER/REPO] [--hostname HOST] [-L|--limit N] [-s|--state open|closed|merged|all] [-H|--head BRANCH] [-B|--base BRANCH] [--json FIELDS]\nDefault: 30 open pull requests.\n",
	view: `pst pr view ${TARGET} [--repo OWNER/REPO] [--hostname HOST] [--json FIELDS]\nWithout an argument, the pull request for the current branch.\n`,
	create:
		"pst pr create -t|--title TITLE [-b|--body BODY | -F|--body-file FILE] [-B|--base BRANCH] [-H|--head BRANCH] [--repo OWNER/REPO] [--hostname HOST]\nDefaults: base is the repository's default branch, head is the current branch. Use --body-file - for stdin.\n",
	merge: `pst pr merge ${TARGET} [-m|--merge] [-t|--subject TEXT] [-b|--body TEXT | -F|--body-file FILE] [--match-head-commit SHA] [--repo OWNER/REPO] [--hostname HOST]\nOnly merge commits are supported; --squash and --rebase are rejected by the server.\n`,
	close: `pst pr close ${TARGET} [-c|--comment TEXT] [--repo OWNER/REPO] [--hostname HOST]\n`,
	reopen: `pst pr reopen ${TARGET} [-c|--comment TEXT] [--repo OWNER/REPO] [--hostname HOST]\n`,
	checkout: `pst pr checkout ${TARGET} [-b|--branch NAME] [-f|--force] [--repo OWNER/REPO] [--hostname HOST]\nRun inside a clone; fetches the head branch and checks it out.\n`,
};

function jsonFields(fields: string | undefined) {
	if (fields === undefined) return;
	if (
		!fields ||
		fields.split(",").some((field) => !Object.hasOwn(JSON_FIELDS, field))
	) {
		throw new CliError(
			`Invalid JSON fields: "${fields}"\nAvailable fields:\n  ${Object.keys(JSON_FIELDS).sort().join("\n  ")}`,
		);
	}
}
function print(io: Io, fields: string, value: Pull | Pull[]) {
	const pick = (pull: Pull) =>
		pickFields(fields, JSON_FIELDS as never, pull as never);
	io.stdout(
		`${JSON.stringify(Array.isArray(value) ? value.map(pick) : pick(value), null, 2)}\n`,
	);
}
async function readBody(
	io: Io,
	values: { body?: string; "body-file"?: string },
) {
	if (values.body !== undefined && values["body-file"] !== undefined)
		throw new CliError("--body and --body-file cannot be combined");
	if (values["body-file"] === "")
		throw new CliError("--body-file requires a path or -");
	if (values["body-file"] === undefined) return values.body;
	return values["body-file"] === "-"
		? io.readStdin()
		: readFile(values["body-file"], "utf8");
}
async function context(
	io: Io,
	values: { hostname?: string; repo?: string },
	auth = false,
) {
	const host = resolveHost(io, values.hostname);
	const ref = await resolveRepo(io, host, values.repo);
	const client = await connect(io, host, auth);
	const repoPath = `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
	return { client, repoPath, path: `${repoPath}/pulls` };
}
function requireGit(io: Io) {
	if (!io.git) throw new CliError("git is not available");
	return io.git;
}
async function currentBranch(io: Io) {
	const git = requireGit(io);
	let branch: string;
	try {
		branch = (await git(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
	} catch {
		throw new CliError("could not determine the current branch");
	}
	if (!branch) throw new CliError("could not determine the current branch");
	return branch;
}
/** A number, a URL ending in /pulls/N, a branch name, or (none) the current branch. */
async function findPull(
	io: Io,
	client: Client,
	path: string,
	positionals: string[],
) {
	if (positionals.length > 1)
		throw new CliError("expected at most one pull request argument");
	const raw = positionals[0];
	const number = raw?.match(/^#?([1-9]\d*)$|\/pulls\/([1-9]\d*)\/?$/);
	if (number) {
		const n = Number(number[1] ?? number[2]);
		if (!Number.isSafeInteger(n))
			throw new CliError("invalid pull request number");
		return (await client.json<Pull>(`${path}/${n}`)).data;
	}
	if (raw === "")
		throw new CliError("expected a pull request number or branch");
	const branch = raw ?? (await currentBranch(io));
	const { data } = await client.json<Pull[]>(path, {
		query: { head: branch, state: "open", per_page: 1 },
	});
	const [found] = data;
	if (!found)
		throw new CliError(`no open pull requests found for branch "${branch}"`);
	return found;
}
async function list(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...common,
		limit: { type: "string", short: "L", default: "30" },
		state: { type: "string", short: "s", default: "open" },
		head: { type: "string", short: "H" },
		base: { type: "string", short: "B" },
		json: { type: "string" },
	});
	if (values.help) {
		io.stdout(HELP.list as string);
		return;
	}
	if (positionals.length)
		throw new CliError("pr list accepts no positional arguments");
	const limit = Number(values.limit);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
		throw new CliError("--limit must be an integer from 1 to 10000");
	if (!["open", "closed", "merged", "all"].includes(values.state))
		throw new CliError("--state must be open, closed, merged or all");
	for (const flag of ["head", "base"] as const)
		if (values[flag] !== undefined && !values[flag].trim())
			throw new CliError(`--${flag} requires a nonempty value`);
	jsonFields(values.json);
	const { client, path } = await context(io, values);
	const merged = values.state === "merged";
	const pulls: Pull[] = [];
	let next: string | undefined = path;
	const visited = new Set<string>();
	while (next && pulls.length < limit) {
		if (visited.has(next))
			throw new CliError("API returned a repeated pagination link");
		visited.add(next);
		const page: { data: Pull[]; response: Response } = await client.json<
			Pull[]
		>(
			next,
			visited.size === 1
				? {
						query: {
							per_page: merged ? 100 : Math.min(limit, 100),
							state: merged ? "closed" : values.state,
							head: values.head,
							base: values.base,
						},
					}
				: undefined,
		);
		pulls.push(
			...page.data
				.filter((pull) => !merged || pull.merged_at)
				.slice(0, limit - pulls.length),
		);
		next = nextLink(page.response);
	}
	if (values.json !== undefined) return print(io, values.json, pulls);
	for (const pull of pulls)
		io.stdout(
			`${pull.number}\t${pull.title}\t${pull.head.ref}\t${stateOf(pull)}\t${pull.created_at}\n`,
		);
	if (!pulls.length) io.stderr("no pull requests found\n");
}
async function view(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...common,
		json: { type: "string" },
	});
	if (values.help) {
		io.stdout(HELP.view as string);
		return;
	}
	jsonFields(values.json);
	const { client, path } = await context(io, values);
	const pull = await findPull(io, client, path, positionals);
	if (values.json !== undefined) return print(io, values.json, pull);
	io.stdout(
		`${pull.title} #${pull.number}\n${stateOf(pull)} • ${pull.user.login} wants to merge into ${pull.base.ref} from ${pull.head.ref}\n${pull.html_url}\n\n${pull.body ?? ""}\n`,
	);
}
async function create(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...common,
		title: { type: "string", short: "t" },
		body: { type: "string", short: "b" },
		"body-file": { type: "string", short: "F" },
		base: { type: "string", short: "B" },
		head: { type: "string", short: "H" },
	});
	if (values.help) {
		io.stdout(HELP.create as string);
		return;
	}
	if (positionals.length)
		throw new CliError("pr create accepts no positional arguments");
	if (!values.title?.trim()) throw new CliError("--title is required");
	for (const flag of ["head", "base"] as const)
		if (values[flag] !== undefined && !values[flag].trim())
			throw new CliError(`--${flag} requires a nonempty value`);
	const body = await readBody(io, values);
	const head = values.head ?? (await currentBranch(io));
	const { client, path, repoPath } = await context(io, values, true);
	const base =
		values.base ??
		(await client.json<{ default_branch: string }>(repoPath)).data
			.default_branch;
	if (head === base)
		throw new CliError(`head branch "${head}" is the same as base branch`);
	const { data } = await client.json<Pull>(path, {
		method: "POST",
		body: { title: values.title, body, head, base },
	});
	io.stdout(`${data.html_url}\n`);
}
async function merge(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...common,
		merge: { type: "boolean", short: "m" },
		squash: { type: "boolean", short: "s" },
		rebase: { type: "boolean", short: "r" },
		subject: { type: "string", short: "t" },
		body: { type: "string", short: "b" },
		"body-file": { type: "string", short: "F" },
		"match-head-commit": { type: "string" },
	});
	if (values.help) {
		io.stdout(HELP.merge as string);
		return;
	}
	const methods = (["merge", "squash", "rebase"] as const).filter(
		(method) => values[method],
	);
	if (methods.length > 1)
		throw new CliError("only one of --merge, --squash or --rebase may be used");
	const body = await readBody(io, values);
	const { client, path } = await context(io, values, true);
	const pull = await findPull(io, client, path, positionals);
	if (pull.merged_at)
		throw new CliError(`pull request #${pull.number} was already merged`);
	if (pull.state !== "open")
		throw new CliError(`pull request #${pull.number} is closed`);
	await client.json(`${path}/${pull.number}/merge`, {
		method: "PUT",
		body: {
			merge_method: methods[0] ?? "merge",
			commit_title: values.subject,
			commit_message: body,
			sha: values["match-head-commit"],
		},
	});
	io.stderr(`✓ Merged pull request #${pull.number} (${pull.title})\n`);
}
async function changeState(io: Io, args: string[], state: "open" | "closed") {
	const sub = state === "closed" ? "close" : "reopen";
	const { values, positionals } = parse(args, {
		...common,
		comment: { type: "string", short: "c" },
	});
	if (values.help) {
		io.stdout(HELP[sub] as string);
		return;
	}
	if (values.comment !== undefined && !values.comment.trim())
		throw new CliError("--comment requires a nonempty value");
	const { client, path, repoPath } = await context(io, values, true);
	const pull = await findPull(io, client, path, positionals);
	if (pull.merged_at)
		throw new CliError(
			`pull request #${pull.number} can't be ${sub === "close" ? "closed" : "reopened"} because it was already merged`,
		);
	if (pull.state === state) {
		io.stderr(
			`! Pull request #${pull.number} (${pull.title}) is already ${state}\n`,
		);
		return;
	}
	if (values.comment !== undefined)
		await client.json(`${repoPath}/issues/${pull.number}/comments`, {
			method: "POST",
			body: { body: values.comment },
		});
	await client.json<Pull>(`${path}/${pull.number}`, {
		method: "PATCH",
		body: { state },
	});
	io.stderr(
		`✓ ${state === "closed" ? "Closed" : "Reopened"} pull request #${pull.number} (${pull.title})\n`,
	);
}
/** Git's check-ref-format rules for a branch, checked before any git call. */
export function isBranchName(name: string) {
	return (
		name.length > 0 &&
		name.length <= 255 &&
		name !== "@" &&
		!name.startsWith("-") &&
		!name.startsWith("/") &&
		!name.endsWith("/") &&
		!name.endsWith(".") &&
		!name.includes("..") &&
		!name.includes("//") &&
		!name.includes("@{") &&
		// biome-ignore lint/suspicious/noControlCharactersInRegex: git forbids them
		!/[\x00-\x20\x7f~^:?*[\\]/.test(name) &&
		name
			.split("/")
			.every((part) => !part.startsWith(".") && !part.endsWith(".lock"))
	);
}
async function checkout(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...common,
		branch: { type: "string", short: "b" },
		force: { type: "boolean", short: "f" },
	});
	if (values.help) {
		io.stdout(HELP.checkout as string);
		return;
	}
	if (positionals.length !== 1)
		throw new CliError("expected one pull request number or branch");
	if (values.branch !== undefined && !values.branch.trim())
		throw new CliError("--branch requires a nonempty value");
	const git = requireGit(io);
	const { client, path } = await context(io, values);
	const pull = await findPull(io, client, path, positionals);
	const url = pull.head.repo?.clone_url;
	if (!url) throw new CliError("the pull request's head repository is unknown");
	let protocol: string;
	try {
		protocol = new URL(url).protocol;
	} catch {
		protocol = "";
	}
	if (protocol !== "https:" && protocol !== "http:")
		throw new CliError(`refusing to fetch from non-HTTP URL "${url}"`);
	const local = values.branch ?? pull.head.ref;
	for (const name of [pull.head.ref, local])
		if (!isBranchName(name))
			throw new CliError(`invalid branch name "${name}"`);
	await git(["fetch", "--", url, `refs/heads/${pull.head.ref}`]);
	let exists = true;
	try {
		await git(["rev-parse", "--verify", "--quiet", `refs/heads/${local}`]);
	} catch {
		exists = false;
	}
	if (!exists) {
		await git(["checkout", "-b", local, "FETCH_HEAD"]);
		return;
	}
	await git(["checkout", local, "--"]);
	await git(
		values.force
			? ["reset", "--hard", "FETCH_HEAD"]
			: ["merge", "--ff-only", "FETCH_HEAD"],
	);
}
export async function prCommand(io: Io, args: string[]) {
	let [sub, ...rest] = args;
	if (sub === "ls") sub = "list";
	if (sub === "co") sub = "checkout";
	if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
		const requested = sub === "help" ? rest[0] : undefined;
		if (requested && !Object.hasOwn(HELP, requested))
			throw new CliError(`unknown pr subcommand "${requested}"`);
		io.stdout(
			requested
				? (HELP[requested] as string)
				: `Usage: pst pr <list|view|create|merge|close|reopen|checkout> [flags]\n\n${Object.values(HELP).join("\n")}`,
		);
		return;
	}
	if (!Object.hasOwn(HELP, sub))
		throw new CliError(`unknown pr subcommand "${sub}"`);
	switch (sub) {
		case "list":
			return list(io, rest);
		case "view":
			return view(io, rest);
		case "create":
			return create(io, rest);
		case "merge":
			return merge(io, rest);
		case "close":
			return changeState(io, rest, "closed");
		case "reopen":
			return changeState(io, rest, "open");
		case "checkout":
			return checkout(io, rest);
	}
}
