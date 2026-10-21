import type { Output } from "@pushstack/api-contract/client";
import { parse, printJsonFields } from "../args";
import { type Client, connect } from "../client";
import { resolveHost } from "../config";
import { CliError, type Io } from "../io";
import { parseRepoArg, resolveRepo } from "../repo-resolve";

type Repo = Output<"repos/get">;

/** `--json` fields, named as in `gh repo view --json`. */
const JSON_FIELDS = {
	name: (r: Repo) => r.name,
	nameWithOwner: (r: Repo) => r.full_name,
	owner: (r: Repo) => ({ login: r.owner.login }),
	description: (r: Repo) => r.description ?? "",
	url: (r: Repo) => r.html_url,
	isPrivate: (r: Repo) => r.private,
	visibility: (r: Repo) => r.visibility.toUpperCase(),
	isArchived: (r: Repo) => r.archived,
	defaultBranchRef: (r: Repo) => ({ name: r.default_branch }),
	stargazerCount: (r: Repo) => r.stargazers_count,
	createdAt: (r: Repo) => r.created_at,
	updatedAt: (r: Repo) => r.updated_at,
};

const hostOption = { hostname: { type: "string" } } as const;

async function view(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...hostOption,
		json: { type: "string" },
		repo: { type: "string", short: "R" },
	});
	if (positionals.length > 1) throw new CliError("accepts at most 1 arg");
	const host = resolveHost(io, values.hostname);
	const ref = positionals[0]
		? parseRepoArg(positionals[0])
		: await resolveRepo(io, host, values.repo);
	const client = await connect(io, host);
	const { data: repo } = await client.call("repos/get", {
		owner: ref.owner,
		repo: ref.name,
	});
	if (values.json)
		return printJsonFields(
			io,
			values.json,
			JSON_FIELDS as never,
			repo as never,
		);
	if (io.isTTY) {
		io.stdout(
			`${repo.full_name}\n${repo.description ?? ""}\n\nView this repository on PushStack: ${repo.html_url}\n`,
		);
	} else {
		io.stdout(
			`name:\t${repo.full_name}\ndescription:\t${repo.description ?? ""}\n`,
		);
	}
}

async function list(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...hostOption,
		limit: { type: "string", short: "L", default: "30" },
		visibility: { type: "string" },
		json: { type: "string" },
	});
	if (positionals.length > 1) throw new CliError("accepts at most 1 arg");
	const limit = Number(values.limit);
	if (!Number.isInteger(limit) || limit < 1) {
		throw new CliError(`invalid limit: ${values.limit}`);
	}
	if (values.visibility && !["public", "private"].includes(values.visibility)) {
		throw new CliError(
			`invalid argument "${values.visibility}" for "--visibility" flag: valid values are {public|private}`,
		);
	}
	const host = resolveHost(io, values.hostname);
	const client = await connect(io, host);
	let owner = positionals[0];
	// Resolve the active token's identity: an environment token may belong to
	// a different user than the stored account, or have no stored account.
	if (owner && client.credentials) {
		const { login } = (await client.call("users/get-authenticated")).data;
		if (login === owner) owner = undefined;
	}
	if (!owner && !client.credentials) {
		throw new CliError(
			`not logged in to ${host}; pass an owner or run: pst auth login --with-token`,
			4,
		);
	}
	const repos = await collect(
		client,
		owner,
		limit,
		values.visibility as "public" | "private" | undefined,
	);
	if (values.json)
		return printJsonFields(
			io,
			values.json,
			JSON_FIELDS as never,
			repos as never,
		);
	for (const repo of repos) {
		io.stdout(
			`${repo.full_name}\t${repo.description ?? ""}\t${repo.visibility}\t${repo.updated_at}\n`,
		);
	}
	if (repos.length === 0) {
		io.stderr(
			owner
				? `no repositories found for ${owner}\n`
				: "no repositories found\n",
		);
	}
}

/** Up to `limit` of `owner`'s repositories (the caller's own when unset). */
async function collect(
	client: Client,
	owner: string | undefined,
	limit: number,
	visibility: "public" | "private" | undefined,
) {
	const per_page = Math.min(100, limit);
	const pages = owner
		? client.pages("repos/list-for-user", { username: owner, per_page })
		: client.pages("repos/list-for-authenticated-user", {
				per_page,
				visibility,
				affiliation: ["owner"],
			});
	const repos: Repo[] = [];
	for await (const page of pages) {
		repos.push(
			...page.filter((repo) => !visibility || repo.visibility === visibility),
		);
		if (repos.length >= limit) break;
	}
	return repos.slice(0, limit);
}

async function create(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...hostOption,
		public: { type: "boolean" },
		private: { type: "boolean" },
		internal: { type: "boolean" },
		description: { type: "string", short: "d" },
		"add-readme": { type: "boolean" },
		gitignore: { type: "string", short: "g" },
		license: { type: "string", short: "l" },
		clone: { type: "boolean", short: "c" },
		source: { type: "string", short: "s" },
		remote: { type: "string", short: "r" },
		push: { type: "boolean" },
		homepage: { type: "string", short: "h" },
	});
	if (positionals.length !== 1) {
		throw new CliError(
			"repository name required: pst repo create <name> --public|--private",
		);
	}
	for (const flag of [
		"clone",
		"source",
		"remote",
		"push",
		"internal",
	] as const) {
		if (values[flag]) {
			throw new CliError(`--${flag} is not supported yet`);
		}
	}
	const visibilityFlags = [values.public, values.private].filter(Boolean);
	if (visibilityFlags.length !== 1) {
		throw new CliError("one of --public or --private required");
	}
	const argument = positionals[0] as string;
	const parts = argument.split("/");
	if (
		parts.length > 2 ||
		parts.some(
			(part) =>
				!/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..",
		)
	) {
		throw new CliError(`invalid repository name "${argument}"`);
	}
	if (values.homepage !== undefined)
		throw new CliError("--homepage is not supported yet");
	const name = parts.at(-1) as string;
	const host = resolveHost(io, values.hostname);
	const client = await connect(io, host, true);
	if (parts.length === 2) {
		const me = (await client.call("users/get-authenticated")).data.login;
		if (parts[0] !== me) {
			throw new CliError(
				`cannot create ${argument}: repositories can only be created under ${me}`,
			);
		}
	}
	const { data: repo } = await client.call(
		"repos/create-for-authenticated-user",
		{
			name,
			description: values.description,
			private: Boolean(values.private),
			auto_init: values["add-readme"] || undefined,
			gitignore_template: values.gitignore,
			license_template: values.license,
		},
	);
	io.stdout(
		io.isTTY
			? `✓ Created repository ${repo.full_name} on PushStack\n  ${repo.html_url}\n`
			: `${repo.html_url}\n`,
	);
}

export async function repoCommand(io: Io, args: string[]) {
	const [sub, ...rest] = args;
	switch (sub) {
		case "view":
			return view(io, rest);
		case "list":
		case "ls":
			return list(io, rest);
		case "create":
		case "new":
			return create(io, rest);
		default:
			throw new CliError(
				`usage: pst repo <view|list|create>${sub ? `\nunknown subcommand "${sub}"` : ""}`,
			);
	}
}
