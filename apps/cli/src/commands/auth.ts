import { parse } from "../args";
import { connect } from "../client";
import {
	credentialsFor,
	hostsFile,
	readHosts,
	resolveHost,
	writeHosts,
} from "../config";
import { CliError, EXIT_AUTH, type Io } from "../io";

interface User {
	login: string;
}

const options = {
	hostname: { type: "string", short: "h" },
	"with-token": { type: "boolean" },
	"show-token": { type: "boolean", short: "t" },
} as const;

function mask(token: string) {
	return `${token.slice(0, 4)}${"*".repeat(Math.max(0, token.length - 4))}`;
}

async function login(io: Io, args: string[]) {
	const { values } = parse(args, options, { positionals: false });
	if (!values["with-token"]) {
		throw new CliError(
			"interactive login is not supported yet; pass a personal access token on stdin: pst auth login --with-token < token.txt",
		);
	}
	const host = resolveHost(io, values.hostname);
	const token = (await io.readStdin()).trim();
	if (!token) throw new CliError("no token on stdin");
	const client = await connect(io, host, false, token);
	let user: User;
	try {
		user = (await client.json<User>("user")).data;
	} catch (error) {
		throw new CliError(
			`could not log in to ${host}: ${(error as Error).message}`,
			(error as CliError).exitCode,
		);
	}
	const hosts = await readHosts(io);
	hosts[host] = { user: user.login, token };
	await writeHosts(io, hosts);
	io.stderr(`✓ Logged in as ${user.login}\n`);
}

async function logout(io: Io, args: string[]) {
	const { values } = parse(args, options, { positionals: false });
	const hosts = await readHosts(io);
	const host = values.hostname ?? Object.keys(hosts)[0];
	const entry = host ? hosts[host] : undefined;
	if (!host || !entry) {
		throw new CliError(
			values.hostname
				? `not logged in to ${values.hostname}`
				: "not logged in to any hosts",
		);
	}
	delete hosts[host];
	await writeHosts(io, hosts);
	io.stderr(`✓ Logged out of ${host} account ${entry.user}\n`);
}

async function status(io: Io, args: string[]) {
	const { values } = parse(args, options, { positionals: false });
	const hosts = await readHosts(io);
	const names = values.hostname
		? [values.hostname]
		: [...new Set([...Object.keys(hosts), ...(io.env.PST_TOKEN ? [resolveHost(io, undefined)] : [])])];
	if (names.length === 0) {
		throw new CliError(
			"You are not logged into any PushStack hosts. To log in, run: pst auth login --with-token",
			EXIT_AUTH,
		);
	}
	let failed = false;
	let text = "";
	for (const host of names) {
		const credentials = await credentialsFor(io, host);
		if (!credentials) {
			failed = true;
			text += `${host}\n  X Not logged in. To log in, run: pst auth login --with-token --hostname ${host}\n`;
			continue;
		}
		const where =
			credentials.source === "PST_TOKEN" ? "PST_TOKEN" : hostsFile(io);
		const client = await connect(io, host);
		try {
			const { data } = await client.json<User>("user");
			text += `${host}\n  ✓ Logged in to ${host} account ${data.login} (${where})\n  - Active account: true\n  - Git operations protocol: https\n  - Token: ${values["show-token"] ? credentials.token : mask(credentials.token)}\n`;
		} catch (error) {
			failed = true;
			text += `${host}\n  X Failed to log in to ${host} account ${credentials.user ?? ""} (${where})\n  - The token is invalid: ${(error as Error).message}\n`;
		}
	}
	// gh prints status to stdout on success and stderr on failure.
	if (failed) {
		io.stderr(text);
		throw new CliError("", 1);
	}
	io.stdout(text);
}

async function token(io: Io, args: string[]) {
	const { values } = parse(args, options, { positionals: false });
	const host = resolveHost(io, values.hostname);
	const credentials = await credentialsFor(io, host);
	if (!credentials) {
		throw new CliError(`no token found for ${host}`);
	}
	io.stdout(`${credentials.token}\n`);
}

const SUBCOMMANDS = { login, logout, status, token } as const;

export async function authCommand(io: Io, args: string[]) {
	const [sub, ...rest] = args;
	const handler = SUBCOMMANDS[sub as keyof typeof SUBCOMMANDS];
	if (!handler) {
		throw new CliError(
			`usage: pst auth <login|logout|status|token>${sub ? `\nunknown subcommand "${sub}"` : ""}`,
		);
	}
	await handler(io, rest);
}
