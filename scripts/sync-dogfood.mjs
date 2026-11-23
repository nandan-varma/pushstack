#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function missingTags(source, destination) {
	const existing = new Map(destination);
	return source.filter(([name, oid]) => {
		const current = existing.get(name);
		if (current && current !== oid)
			throw new Error(`Refusing to move published tag ${name}`);
		return !current;
	});
}

function run(command, args, input) {
	const result = spawnSync(command, args, { encoding: "utf8", input });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(" ")}: ${result.stderr.trim()}`);
	return result.stdout.trim();
}

function tags(remote) {
	return run("git", ["ls-remote", "--tags", "--refs", remote])
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [oid, ref] = line.split(/\s+/);
			return [ref.slice("refs/tags/".length), oid];
		});
}

function api(host, repo, path, body) {
	return JSON.parse(
		run(
			"gh",
			[
				"api",
				"--hostname",
				host,
				`repos/${repo}/${path}`,
				...(body
					? ["--method", "POST", "--input", "-"]
					: ["--paginate", "--slurp"]),
			],
			body ? JSON.stringify(body) : undefined,
		),
	);
}

async function main() {
	const apply = process.argv.includes("--apply");
	if (process.argv.slice(2).some((arg) => arg !== "--apply"))
		throw new Error("Usage: node scripts/sync-dogfood.mjs [--apply]");
	const source = new URL(run("git", ["remote", "get-url", "origin"]));
	const destination = new URL(run("git", ["remote", "get-url", "pushstack"]));
	if (
		source.username ||
		source.password ||
		destination.username ||
		destination.password
	)
		throw new Error(
			"Remotes must use credential helpers, not embedded credentials",
		);
	if (
		source.hostname !== "github.com" ||
		destination.hostname !== "git.nandan.fyi" ||
		source.protocol !== "https:" ||
		destination.protocol !== "https:"
	)
		throw new Error(
			"Expected the project's GitHub origin and PushStack HTTPS remotes",
		);
	const sourceRepo = source.pathname.slice(1).replace(/\.git$/, "");
	const destinationRepo = destination.pathname.slice(1).replace(/\.git$/, "");
	run("git", ["fetch", "origin", "--tags"]);
	run("git", ["fetch", "pushstack", "main"]);
	run("git", ["merge-base", "--is-ancestor", "pushstack/main", "origin/main"]);
	const pendingTags = missingTags(tags("origin"), tags("pushstack"));
	const releases = api(source.hostname, sourceRepo, "releases")
		.flat()
		.filter((release) => !release.draft);
	const existingReleases = new Set(
		api(destination.hostname, destinationRepo, "releases")
			.flat()
			.map((release) => release.tag_name),
	);
	const pendingReleases = releases.filter(
		(release) => !existingReleases.has(release.tag_name),
	);
	if (pendingReleases.some((release) => release.assets.length))
		throw new Error(
			"Release assets need a separate transfer; refusing to publish incomplete releases",
		);
	console.info(
		`${apply ? "Syncing" : "Plan:"} main (fast-forward only), ${pendingTags.length} missing tags, ${pendingReleases.length} published releases`,
	);
	if (!apply) return;
	run("git", [
		"push",
		"pushstack",
		"origin/main:refs/heads/main",
		...pendingTags.map(([tag]) => `refs/tags/${tag}:refs/tags/${tag}`),
	]);
	for (const release of pendingReleases.reverse()) {
		api(destination.hostname, destinationRepo, "releases", {
			tag_name: release.tag_name,
			name: release.name,
			body: release.body ?? "",
			prerelease: release.prerelease,
		});
		console.info(`Published ${release.tag_name} on PushStack`);
	}
	const sourceTip = run("git", ["rev-parse", "origin/main"]);
	const destinationTip = run("git", [
		"ls-remote",
		"pushstack",
		"refs/heads/main",
	]).split(/\s+/)[0];
	if (sourceTip !== destinationTip)
		throw new Error("Remote main tips differ after sync");
	const remaining = missingTags(tags("origin"), tags("pushstack"));
	const verified = new Set(
		api(destination.hostname, destinationRepo, "releases")
			.flat()
			.map((release) => release.tag_name),
	);
	if (
		remaining.length ||
		releases.some((release) => !verified.has(release.tag_name))
	)
		throw new Error("Remote verification found missing tags or releases");
	console.info(
		`Verified both main tips at ${sourceTip.slice(0, 12)} and all published tags/releases`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
