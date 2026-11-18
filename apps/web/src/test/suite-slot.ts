import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Machine-wide limit on concurrent full test runs. One run already uses
 * several workers and Postgres WASM, so a dozen at once (parallel agents, a
 * watcher plus a CI-style run) starve the machine and make timing-based tests
 * flake. A run waits for a free slot; a slot whose process is gone is reused.
 * CI runs alone and skips this.
 */
const SLOTS = Number(process.env.VITEST_SLOTS ?? 2);
const DIR = path.join(tmpdir(), "pushstack-vitest-slots");

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function tryClaim(slot: number): Promise<string | null> {
	const dir = path.join(DIR, String(slot));
	try {
		await mkdir(dir);
	} catch {
		const owner = Number(
			await readFile(path.join(dir, "pid"), "utf8").catch(() => 0),
		);
		if (owner && alive(owner)) return null;
		await rm(dir, { recursive: true, force: true });
		return tryClaim(slot);
	}
	await writeFile(path.join(dir, "pid"), String(process.pid));
	return dir;
}

/** Wait for a slot and return the function that frees it. */
export async function acquireSuiteSlot(): Promise<() => Promise<void>> {
	if (process.env.CI) return async () => {};
	await mkdir(DIR, { recursive: true });
	for (;;) {
		for (let slot = 0; slot < SLOTS; slot++) {
			const dir = await tryClaim(slot);
			if (dir) return () => rm(dir, { recursive: true, force: true });
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
}
