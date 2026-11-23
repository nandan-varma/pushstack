// @vitest-environment node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);
const script = path.resolve("scripts/seed-local.ts");
const localDir = path.resolve(".pushstack-local", `refused-${process.pid}`);
const localEnv = {
	...process.env,
	NODE_ENV: "development",
	PUSHSTACK_LOCAL_DIR: localDir,
	BETTER_AUTH_URL: "http://localhost:3000",
	DATABASE_URL: "",
	R2_ENDPOINT: "",
	R2_BUCKET_NAME: "",
	R2_ACCESS_KEY_ID: "",
	R2_SECRET_ACCESS_KEY: "",
};

test.each([
	{ NODE_ENV: "production" },
	{ PUSHSTACK_LOCAL_DIR: "" },
	{ DATABASE_URL: "postgres://example.invalid/production" },
	{ R2_BUCKET_NAME: "production" },
	{ R2_SECRET_ACCESS_KEY: "configured" },
	{ BETTER_AUTH_URL: "https://git.example.invalid" },
	{ BETTER_AUTH_URL: "http://localhost.example.invalid" },
])(
	"rejects an unsafe seed environment before creating data: %j",
	async (override) => {
		await expect(
			execute(process.execPath, ["--import", "tsx", script], {
				env: { ...localEnv, ...override },
			}),
		).rejects.toMatchObject({
			stderr: expect.stringContaining(
				"Demo data may only be created in an offline local database",
			),
		});
		expect(existsSync(localDir)).toBe(false);
	},
);
