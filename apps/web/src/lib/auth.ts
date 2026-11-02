import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db/index";
import * as authSchema from "#/db/schema";
import { env } from "#/server/env";
import { rateLimitStorage } from "#/server/rate-limit";
import { sendEmail } from "./email";
import { isReservedName } from "./reserved-names";
import { MAX_USERNAME_LENGTH, STORAGE_NAME_RE } from "./storage-name";

const authSecret = env.BETTER_AUTH_SECRET;

if (!authSecret) {
	throw new Error("BETTER_AUTH_SECRET environment variable is required");
}

// The origin this deployment is served from (a Worker `vars` entry). Better
// Auth uses it as its trusted origin and for the cookies it issues, so every
// deployment, staging included, names its own host.
const APP_URL = env.BETTER_AUTH_URL;

if (!APP_URL) {
	throw new Error("BETTER_AUTH_URL environment variable is required");
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// A user's repositories live under `repos/{username}/` in storage
// (git-storage-naming.ts), so the username is required and can't change:
// changing it would orphan every repository the user owns, and let whoever
// later took the old name inherit that storage. The username plugin exposes
// username changes through update-user, so they're refused here, server-side.
//
// `email` is listed for the same reason every other invariant here is: the
// refusal has to be a line in this app, not a property of whichever Better
// Auth flow happens to be enabled. Today /update-user rejects an email field
// itself and /change-email is off (`user.changeEmail.enabled` is unset), but
// turning that flow on would otherwise silently make the address mutable.
const IMMUTABLE_USER_FIELDS = ["username", "displayUsername", "email"];

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		schema: authSchema,
		provider: "pg",
	}),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		minPasswordLength: 8,
		sendResetPassword: async ({ user, url }) => {
			await sendEmail({
				to: user.email,
				subject: "Reset your PushStack password",
				html: `<p>Hi ${escapeHtml(user.name || user.email)},</p><p>Click <a href="${escapeHtml(url)}">here</a> to reset your password. This link expires in 1 hour.</p><p>If you didn't request this, you can ignore this email.</p>`,
			});
		},
	},
	emailVerification: {
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url }) => {
			await sendEmail({
				to: user.email,
				subject: "Verify your PushStack email",
				html: `<p>Hi ${escapeHtml(user.name || user.email)},</p><p>Click <a href="${escapeHtml(url)}">here</a> to verify your email address.</p>`,
			});
		},
	},
	databaseHooks: {
		user: {
			create: {
				before: async (data) => {
					if (typeof data.username !== "string" || !data.username) {
						throw new APIError("BAD_REQUEST", {
							message: "A username is required",
						});
					}
				},
			},
			update: {
				before: async (data) => {
					const changed = IMMUTABLE_USER_FIELDS.filter(
						(field) => field in data && data[field] !== undefined,
					);
					if (changed.length > 0) {
						throw new APIError("BAD_REQUEST", {
							message: `${changed.join(", ")} can't be changed`,
						});
					}
				},
			},
		},
	},
	secret: authSecret,
	baseURL: APP_URL,
	trustedOrigins: [APP_URL],
	session: {
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},
	rateLimit: {
		enabled: true,
		window: 60,
		max: 20,
		// Counters in Postgres rather than Better Auth's default per-instance
		// Map — a limit that multiplies by the number of Worker isolates is not a
		// limit. See server/rate-limit.ts.
		customStorage: rateLimitStorage,
	},
	advanced: {
		// Better Auth reads `X-Forwarded-For` by default, which the caller
		// controls; `CF-Connecting-IP` is set by Cloudflare and cannot be spoofed.
		ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
		cookiePrefix: "pushstack",
		useSecureCookies: true,
		crossSubDomainCookies: {
			enabled: false,
		},
	},
	plugins: [
		tanstackStartCookies(),
		username({
			minUsernameLength: 3,
			maxUsernameLength: MAX_USERNAME_LENGTH,
			// One storage-path segment: letters, digits, ".", "_", "-", starting
			// and ending alphanumeric — same rule as repository names. Users live
			// at `/{username}`, so top-level route names are reserved.
			usernameValidator: (name) =>
				STORAGE_NAME_RE.test(name) && !isReservedName(name),
		}),
	],
});
