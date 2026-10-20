import { readFile } from "node:fs/promises";
import type { Output } from "@pushstack/api-contract/client";
import { parse, pickFields } from "../args";
import { type Client, connect } from "../client";
import { resolveHost } from "../config";
import { CliError, type Io } from "../io";
import { resolveRepo } from "../repo-resolve";

/** An issue as the API returns it (pull requests carry `pull_request`). */
type Issue = Output<"issues/get">;
const JSON_FIELDS = {
	number: (i: Issue) => i.number,
	title: (i: Issue) => i.title,
	body: (i: Issue) => i.body ?? "",
	state: (i: Issue) => i.state.toUpperCase(),
	stateReason: (i: Issue) => i.state_reason?.toUpperCase() ?? null,
	url: (i: Issue) => i.html_url,
	author: (i: Issue) => ({ login: i.user.login }),
	assignees: (i: Issue) => i.assignees.map(({ login }) => ({ login })),
	labels: (i: Issue) =>
		i.labels.map(({ name, color, description }) => ({
			name,
			color,
			description,
		})),
	createdAt: (i: Issue) => i.created_at,
	updatedAt: (i: Issue) => i.updated_at,
	closedAt: (i: Issue) => i.closed_at,
};
const common = {
	help: { type: "boolean", short: "h" },
	hostname: { type: "string" },
	repo: { type: "string", short: "R" },
} as const;
const HELP: Record<string, string> = {
	list: "pst issue list [--repo OWNER/REPO] [--hostname HOST] [-L|--limit N] [-s|--state open|closed|all] [-l|--label LABEL] [-a|--assignee LOGIN] [--json FIELDS]\nDefault: 30 open issues. Labels may be repeated or comma-separated.\n",
	view: "pst issue view <number> [--repo OWNER/REPO] [--hostname HOST] [--json FIELDS]\n",
	create:
		"pst issue create -t|--title TITLE [-b|--body BODY | -F|--body-file FILE] [-l|--label LABEL] [-a|--assignee LOGIN] [--repo OWNER/REPO] [--hostname HOST]\nLabels and assignees may be repeated or comma-separated. Use --body-file - for stdin.\n",
	close:
		"pst issue close <number> [-r|--reason completed|not_planned] [--repo OWNER/REPO] [--hostname HOST]\nDefault reason: completed.\n",
	reopen: "pst issue reopen <number> [--repo OWNER/REPO] [--hostname HOST]\n",
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
function print(io: Io, fields: string, value: Issue | Issue[]) {
	const pick = (issue: Issue) =>
		pickFields(fields, JSON_FIELDS as never, issue as never);
	io.stdout(
		`${JSON.stringify(Array.isArray(value) ? value.map(pick) : pick(value), null, 2)}\n`,
	);
}
function numberArg(positionals: string[]) {
	const raw = positionals[0];
	if (
		positionals.length !== 1 ||
		!raw ||
		!/^[1-9]\d*$/.test(raw) ||
		!Number.isSafeInteger(Number(raw))
	)
		throw new CliError("expected one positive issue number");
	return Number(raw);
}
function names(values: string[] | undefined, flag: string) {
	const result = values?.flatMap((value) =>
		value.split(",").map((part) => part.trim()),
	);
	if (result?.some((value) => !value))
		throw new CliError(`--${flag} requires a nonempty value`);
	return result;
}
async function context(
	io: Io,
	values: { hostname?: string; repo?: string },
	auth = false,
) {
	const host = resolveHost(io, values.hostname);
	const ref = await resolveRepo(io, host, values.repo);
	const client = await connect(io, host, auth);
	return { client, repo: { owner: ref.owner, repo: ref.name } };
}
type RepoInput = { owner: string; repo: string };
async function getIssue(client: Client, repo: RepoInput, number: number) {
	const { data } = await client.call("issues/get", {
		...repo,
		issue_number: number,
	});
	if (data.pull_request)
		throw new CliError(`#${number} is a pull request, not an issue`);
	return data;
}
async function assignees(client: Client, values: string[] | undefined) {
	if (!values?.includes("@me")) return values;
	const { data } = await client.call("users/get-authenticated");
	return values.map((value) => (value === "@me" ? data.login : value));
}
async function list(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...common,
		limit: { type: "string", short: "L", default: "30" },
		state: { type: "string", short: "s", default: "open" },
		label: { type: "string", short: "l", multiple: true },
		assignee: { type: "string", short: "a" },
		json: { type: "string" },
	});
	if (values.help) {
		io.stdout(HELP.list as string);
		return;
	}
	if (positionals.length)
		throw new CliError("issue list accepts no positional arguments");
	const limit = Number(values.limit);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
		throw new CliError("--limit must be an integer from 1 to 10000");
	if (!["open", "closed", "all"].includes(values.state))
		throw new CliError("--state must be open, closed or all");
	jsonFields(values.json);
	const labels = names(values.label, "label");
	if (values.assignee !== undefined && !values.assignee.trim())
		throw new CliError("--assignee requires a nonempty value");
	const { client, repo } = await context(io, values, values.assignee === "@me");
	const [assignee] =
		(await assignees(
			client,
			values.assignee ? [values.assignee] : undefined,
		)) ?? [];
	const issues: Issue[] = [];
	for await (const page of client.pages("issues/list-for-repo", {
		...repo,
		per_page: Math.min(limit, 100),
		state: values.state as "open" | "closed" | "all",
		labels,
		assignee,
	})) {
		issues.push(
			...page
				.filter((issue) => !issue.pull_request)
				.slice(0, limit - issues.length),
		);
		if (issues.length >= limit) break;
	}
	if (values.json !== undefined) return print(io, values.json, issues);
	for (const issue of issues)
		io.stdout(
			`${issue.number}\t${issue.title}\t${issue.state}\t${issue.updated_at}\n`,
		);
	if (!issues.length) io.stderr("no issues found\n");
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
	const number = numberArg(positionals);
	jsonFields(values.json);
	const { client, repo } = await context(io, values);
	const issue = await getIssue(client, repo, number);
	if (values.json !== undefined) return print(io, values.json, issue);
	io.stdout(
		`${issue.title} #${issue.number}\n${issue.state.toUpperCase()} • ${issue.user.login}\n${issue.html_url}\n\n${issue.body ?? ""}\n`,
	);
}
async function create(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		...common,
		title: { type: "string", short: "t" },
		body: { type: "string", short: "b" },
		"body-file": { type: "string", short: "F" },
		label: { type: "string", short: "l", multiple: true },
		assignee: { type: "string", short: "a", multiple: true },
	});
	if (values.help) {
		io.stdout(HELP.create as string);
		return;
	}
	if (positionals.length)
		throw new CliError("issue create accepts no positional arguments");
	if (!values.title?.trim()) throw new CliError("--title is required");
	if (values.body !== undefined && values["body-file"] !== undefined)
		throw new CliError("--body and --body-file cannot be combined");
	if (values["body-file"] === "")
		throw new CliError("--body-file requires a path or -");
	const labels = names(values.label, "label");
	const assigned = names(values.assignee, "assignee");
	const body =
		values["body-file"] !== undefined
			? values["body-file"] === "-"
				? await io.readStdin()
				: await readFile(values["body-file"], "utf8")
			: values.body;
	const { client, repo } = await context(io, values, true);
	const { data } = await client.call("issues/create", {
		...repo,
		title: values.title,
		body,
		labels,
		assignees: await assignees(client, assigned),
	});
	io.stdout(`${data.html_url}\n`);
}
async function changeState(io: Io, args: string[], state: "open" | "closed") {
	const { values, positionals } = parse(args, {
		...common,
		...(state === "closed"
			? {
					reason: { type: "string", short: "r", default: "completed" } as const,
				}
			: {}),
	});
	if (values.help) {
		io.stdout(HELP[state === "closed" ? "close" : "reopen"] as string);
		return;
	}
	const number = numberArg(positionals);
	if (
		state === "closed" &&
		(typeof values.reason !== "string" ||
			!["completed", "not_planned"].includes(values.reason))
	)
		throw new CliError("--reason must be completed or not_planned");
	const { client, repo } = await context(io, values, true);
	await getIssue(client, repo, number);
	const { data } = await client.call("issues/update", {
		...repo,
		issue_number: number,
		state,
		state_reason:
			state === "open"
				? "reopened"
				: (values.reason as "completed" | "not_planned"),
	});
	io.stdout(`${data.html_url}\n`);
}
export async function issueCommand(io: Io, args: string[]) {
	let [sub, ...rest] = args;
	if (sub === "ls") sub = "list";
	if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
		const requested = sub === "help" ? rest[0] : undefined;
		if (requested && !Object.hasOwn(HELP, requested))
			throw new CliError(`unknown issue subcommand "${requested}"`);
		io.stdout(
			requested
				? (HELP[requested] as string)
				: `Usage: pst issue <list|view|create|close|reopen> [flags]\n\n${Object.values(HELP).join("\n")}`,
		);
		return;
	}
	if (!Object.hasOwn(HELP, sub))
		throw new CliError(`unknown issue subcommand "${sub}"`);
	switch (sub) {
		case "list":
			return list(io, rest);
		case "view":
			return view(io, rest);
		case "create":
			return create(io, rest);
		case "close":
			return changeState(io, rest, "closed");
		case "reopen":
			return changeState(io, rest, "open");
	}
}
