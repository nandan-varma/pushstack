import { readFile } from "node:fs/promises";
import { parse } from "../args";
import { connect, nextLink } from "../client";
import { resolveHost } from "../config";
import { CliError, EXIT_AUTH, type Io } from "../io";
import { resolveRepo } from "../repo-resolve";

/** `-F` value typing, as gh: true/false/null/integers are typed, `@file` is read. */
async function typed(value: string) {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (/^-?\d+$/.test(value)) return Number(value);
	if (value.startsWith("@")) return readFile(value.slice(1), "utf8");
	return value;
}

function splitField(field: string) {
	const index = field.indexOf("=");
	if (index < 1) {
		throw new CliError(
			`field "${field}" requires a value separated by an '=' sign`,
		);
	}
	return [field.slice(0, index), field.slice(index + 1)] as const;
}

export async function apiCommand(io: Io, args: string[]) {
	const { values, positionals } = parse(args, {
		hostname: { type: "string" },
		method: { type: "string", short: "X" },
		header: { type: "string", short: "H", multiple: true },
		field: { type: "string", short: "F", multiple: true },
		"raw-field": { type: "string", short: "f", multiple: true },
		input: { type: "string" },
		include: { type: "boolean", short: "i" },
		paginate: { type: "boolean" },
		silent: { type: "boolean" },
	});
	if (positionals.length !== 1) {
		throw new CliError("pst api <endpoint> [flags]");
	}
	const host = resolveHost(io, values.hostname);

	// {owner}/{repo} placeholders resolve from the current checkout, like gh.
	let endpoint = positionals[0] as string;
	if (/\{(owner|repo)\}/.test(endpoint)) {
		const ref = await resolveRepo(io, host, undefined);
		endpoint = endpoint
			.replaceAll("{owner}", ref.owner)
			.replaceAll("{repo}", ref.name);
	}

	const fields: Record<string, unknown> = {};
	for (const f of values["raw-field"] ?? []) {
		const [key, value] = splitField(f);
		fields[key] = value;
	}
	for (const f of values.field ?? []) {
		const [key, value] = splitField(f);
		fields[key] = await typed(value);
	}
	const hasFields = Object.keys(fields).length > 0;
	if (values.input && hasFields) {
		throw new CliError("--input cannot be combined with -f/-F");
	}
	const method = (
		values.method ?? (hasFields || values.input ? "POST" : "GET")
	).toUpperCase();

	const headers: Record<string, string> = {};
	for (const h of values.header ?? []) {
		const index = h.indexOf(":");
		if (index < 1) throw new CliError(`invalid header "${h}"`);
		headers[h.slice(0, index).trim()] = h.slice(index + 1).trim();
	}

	let body: string | undefined;
	let query: Record<string, string> | undefined;
	if (values.input) {
		body =
			values.input === "-"
				? await io.readStdin()
				: await readFile(values.input, "utf8");
	} else if (hasFields && (method === "GET" || method === "HEAD")) {
		query = Object.fromEntries(
			Object.entries(fields).map(([k, v]) => [k, String(v)]),
		);
	} else if (hasFields) {
		body = JSON.stringify(fields);
	}

	const client = await connect(io, host);
	let path = endpoint;
	let failed = false;
	for (let page = 0; ; page++) {
		const response = await client.raw(path, {
			method,
			headers,
			body,
			query: page === 0 ? query : undefined,
		});
		const text = await response.text();
		if (values.include) {
			let head = `HTTP/1.1 ${response.status} ${response.statusText}\n`;
			response.headers.forEach((value, key) => {
				head += `${key}: ${value}\n`;
			});
			io.stdout(`${head}\n`);
		}
		if (!values.silent && text)
			io.stdout(text.endsWith("\n") ? text : `${text}\n`);
		if (!response.ok) {
			let message = response.statusText;
			try {
				message = (JSON.parse(text) as { message?: string }).message ?? message;
			} catch {}
			io.stderr(`pst: ${message} (HTTP ${response.status})\n`);
			failed = true;
			if (response.status === 401) throw new CliError("", EXIT_AUTH);
			break;
		}
		const next = values.paginate ? nextLink(response) : undefined;
		if (!next) break;
		path = next;
	}
	if (failed) throw new CliError("", 1);
}
