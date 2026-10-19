#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { run } from "./cli";
import { defaultConfigDir } from "./config";
import type { Io } from "./io";

const exec = promisify(execFile);

async function remotes() {
	try {
		const { stdout } = await exec("git", ["remote", "-v"]);
		const urls: string[] = [];
		for (const line of stdout.split("\n")) {
			const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
			if (!match) continue;
			// `origin` first, like gh's remote ordering.
			if (match[1] === "origin") urls.unshift(match[2] as string);
			else urls.push(match[2] as string);
		}
		return urls;
	} catch {
		return [];
	}
}

async function readStdin() {
	let text = "";
	for await (const chunk of process.stdin) text += chunk;
	return text;
}

const io: Io = {
	stdout: (text) => void process.stdout.write(text),
	stderr: (text) => void process.stderr.write(text),
	readStdin,
	env: process.env,
	fetch,
	configDir: defaultConfigDir(process.env),
	remotes,
	isTTY: Boolean(process.stdout.isTTY),
};

process.exitCode = await run(process.argv.slice(2), io);
