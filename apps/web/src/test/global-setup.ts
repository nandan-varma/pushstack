import { acquireSuiteSlot } from "./suite-slot";
import { loadTestTemplate } from "./test-db-template";

/**
 * Takes a machine-wide run slot (see suite-slot.ts), then builds the test
 * database template once, before any worker starts (see test-db-template.ts).
 * Building it here rather than in the first worker that needs it also keeps
 * workers from writing the same cache at once.
 */
export default async function setup(): Promise<() => Promise<void>> {
	const release = await acquireSuiteSlot();
	await loadTestTemplate();
	return release;
}
