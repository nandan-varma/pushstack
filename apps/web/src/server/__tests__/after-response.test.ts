/**
 * @vitest-environment node
 *
 * The after-response seam: inline where no request context exists (dev and
 * tests), registered with the platform's `waitUntil` when one does.
 */
import { describe, expect, it } from "vitest";
import { afterResponse } from "../after-response";

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

describe("afterResponse", () => {
	it("awaits inline without a request context", async () => {
		let finished = false;
		await afterResponse(async () => {
			await Promise.resolve();
			finished = true;
		});
		expect(finished).toBe(true);
	});

	it("hands the task to waitUntil when the runtime provides one", async () => {
		const registered: Promise<unknown>[] = [];
		const holder = globalThis as Record<symbol, unknown>;
		const previous = holder[REQUEST_CONTEXT];
		holder[REQUEST_CONTEXT] = {
			get: () => ({
				waitUntil: (task: Promise<unknown>) => {
					registered.push(task);
				},
			}),
		};
		try {
			let release = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			let finished = false;
			await afterResponse(async () => {
				await gate;
				finished = true;
			});
			expect(finished).toBe(false);
			expect(registered).toHaveLength(1);
			release();
			await registered[0];
			expect(finished).toBe(true);
		} finally {
			holder[REQUEST_CONTEXT] = previous;
		}
	});
});
