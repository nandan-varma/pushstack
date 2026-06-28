import { describe, expect, it } from "vitest";

describe("Production Environment Validation", () => {
	describe("Environment Variables", () => {
		it("validates DATABASE_URL format when present", () => {
			const dbUrl = process.env.DATABASE_URL;
			if (dbUrl) {
				expect(dbUrl).toMatch(/^postgres(ql)?:\/\//);
			}
		});

		it("validates BETTER_AUTH_URL format when present", () => {
			const authUrl = process.env.BETTER_AUTH_URL;
			if (authUrl) {
				expect(authUrl).toMatch(/^https?:\/\//);
			}
		});

		it("validates BETTER_AUTH_SECRET length when present", () => {
			const secret = process.env.BETTER_AUTH_SECRET;
			if (secret) {
				expect(secret.length).toBeGreaterThan(32);
			}
		});
	});

	describe("Git Configuration", () => {
		it("GIT_REPOS_PATH is a non-empty string", () => {
			const p = process.env.GIT_REPOS_PATH || "/tmp/pushstack-repos";
			expect(typeof p).toBe("string");
			expect(p.length).toBeGreaterThan(0);
		});

		it("GIT_HTTP_MAX_BODY_BYTES, if set, is a positive integer", () => {
			const raw = process.env.GIT_HTTP_MAX_BODY_BYTES;
			if (raw !== undefined) {
				const parsed = Number.parseInt(raw, 10);
				expect(Number.isFinite(parsed)).toBe(true);
				expect(parsed).toBeGreaterThan(0);
			}
		});
	});

	describe("R2 Storage Configuration", () => {
		it("R2 bucket name, if set, has no leading/trailing whitespace", () => {
			const bucket = process.env.R2_BUCKET_NAME;
			if (bucket) {
				expect(bucket).toBe(bucket.trim());
			}
		});
	});

	describe("NODE_ENV", () => {
		it("is a recognised value or undefined", () => {
			expect(["development", "test", "production", undefined]).toContain(
				process.env.NODE_ENV,
			);
		});
	});

	describe("Required modules", () => {
		it("isomorphic-git is importable", async () => {
			const git = await import("isomorphic-git");
			expect(typeof git.default.init).toBe("function");
		});

		it("node:child_process is available", async () => {
			const cp = await import("node:child_process");
			expect(typeof cp.spawn).toBe("function");
		});
	});
});
