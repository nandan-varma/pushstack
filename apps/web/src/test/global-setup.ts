import { loadTestTemplate } from "./test-db-template";

/**
 * Builds the test database template once, before any worker starts (see
 * test-db-template.ts). Building it here rather than in the first worker that
 * needs it also keeps workers from writing the same cache at once.
 */
export default async function setup(): Promise<void> {
	await loadTestTemplate();
}
