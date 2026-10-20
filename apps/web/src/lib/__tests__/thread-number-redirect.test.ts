import { isRedirect, notFound } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { ensureThreadNumberRedirect } from "../thread-number-redirect";

const params = { owner: "alice", name: "project", id: "12" };
const routes = [
	"/repo/$owner/$name/issues/$id",
	"/repo/$owner/$name/pulls/$id",
] as const;

describe("shared thread number redirect", () => {
	it.each(routes)(
		"permanently redirects an existing opposite resource to %s",
		async (route) => {
			const result = await ensureThreadNumberRedirect(
				notFound(),
				params,
				async () => ({ id: 5 }),
				route,
			).catch((error) => error);
			expect(isRedirect(result)).toBe(true);
			expect(result.options).toMatchObject({
				to: route,
				params,
				statusCode: 301,
			});
		},
	);
	it("does not probe another resource after an operational failure", async () => {
		const error = new Error("database unavailable");
		const lookup = vi.fn();
		await expect(
			ensureThreadNumberRedirect(error, params, lookup, routes[0]),
		).rejects.toBe(error);
		expect(lookup).not.toHaveBeenCalled();
	});
	it("preserves not found when neither resource exists", async () => {
		const error = notFound();
		await expect(
			ensureThreadNumberRedirect(
				error,
				params,
				async () => {
					throw notFound();
				},
				routes[0],
			),
		).rejects.toBe(error);
	});
	it("surfaces failures while checking the opposite resource", async () => {
		const error = new Error("network failed");
		await expect(
			ensureThreadNumberRedirect(
				notFound(),
				params,
				async () => {
					throw error;
				},
				routes[0],
			),
		).rejects.toBe(error);
	});
});
