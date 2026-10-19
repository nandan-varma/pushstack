import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Io } from "./io";

export const DEFAULT_HOST = "git.nandan.fyi";

export interface HostEntry {
	user: string;
	token: string;
}
export type Hosts = Record<string, HostEntry>;

/** `PST_CONFIG_DIR`, else `$XDG_CONFIG_HOME/pushstack`, else `~/.config/pushstack`. */
export function defaultConfigDir(env: Record<string, string | undefined>) {
	if (env.PST_CONFIG_DIR) return env.PST_CONFIG_DIR;
	const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(base, "pushstack");
}

const file = (io: Io) => join(io.configDir, "hosts.json");

export async function readHosts(io: Io): Promise<Hosts> {
	let text: string;
	try {
		text = await readFile(file(io), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	return JSON.parse(text) as Hosts;
}

/** Written 0600 in a 0700 directory, via a temp file so a crash never leaves a half-written token store. */
export async function writeHosts(io: Io, hosts: Hosts) {
	await mkdir(io.configDir, { recursive: true, mode: 0o700 });
	const target = file(io);
	const temp = `${target}.${process.pid}.tmp`;
	await writeFile(temp, `${JSON.stringify(hosts, null, 2)}\n`, {
		mode: 0o600,
	});
	await chmod(temp, 0o600);
	await rename(temp, target);
}

export function hostsFile(io: Io) {
	return file(io);
}

/** The host to talk to: `--hostname`, then `PST_HOST`, then the default. */
export function resolveHost(io: Io, flag: string | undefined) {
	return flag || io.env.PST_HOST || DEFAULT_HOST;
}

export interface Credentials {
	token: string;
	source: "PST_TOKEN" | "config";
	user?: string;
}

/** `PST_TOKEN` wins over the stored token. */
export async function credentialsFor(
	io: Io,
	host: string,
): Promise<Credentials | null> {
	if (io.env.PST_TOKEN) return { token: io.env.PST_TOKEN, source: "PST_TOKEN" };
	const entry = (await readHosts(io))[host];
	return entry
		? { token: entry.token, source: "config", user: entry.user }
		: null;
}

export function baseUrl(host: string) {
	const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
	return `${local ? "http" : "https"}://${host}/api/v3`;
}
