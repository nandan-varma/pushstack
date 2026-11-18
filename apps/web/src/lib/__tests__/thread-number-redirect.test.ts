import { isRedirect, notFound } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import {
	ensureThreadNumberRedirect,
	type ThreadRoute,
} from "../thread-number-redirect";

const params = { owner: "alice", name: "project", id: "12" };
const routes = [
	"/$owner/$name/issues/$id",
	"/$owner/$name/pull/$id/{-$tab}",
	"/$owner/$name/discussions/$id",
] as const;

describe("shared thread number redirect", () => {
	it.each(routes)(
		"permanently redirects an existing other kind to %s",
		async (route) => {
			const result = await ensureThreadNumberRedirect(notFound(), params, [
				{ route: route as ThreadRoute, find: async () => ({ id: 5 }) },
			]).catch((error) => error);
			expect(isRedirect(result)).toBe(true);
			expect(result.options).toMatchObject({
				to: route,
				params,
				statusCode: 301,
			});
		},
	);
	it("takes the first kind that exists", async () => {
		const lookup = vi.fn(async () => null);
		const result = await ensureThreadNumberRedirect(notFound(), params, [
			{ route: routes[1], find: lookup },
			{ route: routes[2], find: async () => ({ id: 7 }) },
		]).catch((error) => error);
		expect(isRedirect(result)).toBe(true);
		expect(result.options.to).toBe(routes[2]);
	});
	it("does not probe another resource after an operational failure", async () => {
		const error = new Error("database unavailable");
		const lookup = vi.fn();
		await expect(
			ensureThreadNumberRedirect(error, params, [
				{ route: routes[0], find: lookup },
			]),
		).rejects.toBe(error);
		expect(lookup).not.toHaveBeenCalled();
	});
	it("preserves not found when neither resource exists", async () => {
		const error = notFound();
		await expect(
			ensureThreadNumberRedirect(error, params, [
				{
					route: routes[0],
					find: async () => {
						throw notFound();
					},
				},
			]),
		).rejects.toBe(error);
	});
	it("surfaces failures while checking the opposite resource", async () => {
		const error = new Error("network failed");
		await expect(
			ensureThreadNumberRedirect(notFound(), params, [
				{
					route: routes[0],
					find: async () => {
						throw error;
					},
				},
			]),
		).rejects.toBe(error);
	});
});
