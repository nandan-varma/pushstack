import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db/index";
import * as authSchema from "#/db/schema";
import { rateLimitStorage } from "#/server/rate-limit";
import { sendEmail } from "./email";
import { MAX_USERNAME_LENGTH, STORAGE_NAME_RE } from "./storage-name";

const authSecret = process.env.BETTER_AUTH_SECRET;

if (!authSecret) {
	throw new Error("BETTER_AUTH_SECRET environment variable is required");
}

// Vercel sets this per deployment. Add only the exact preview origin instead
// of a wildcard so authenticated preview testing works without widening the
// production CSRF trust boundary to arbitrary Vercel projects.
const vercelPreviewUrl = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: undefined;
const configuredAppUrl =
	process.env.BETTER_AUTH_URL ?? "https://git.nandan.fyi";
// Better Auth also uses baseURL when issuing cookies. A preview must use its
// own host here; otherwise login succeeds server-side but the browser cannot
// receive the session cookie for the preview origin.
const APP_URL = vercelPreviewUrl ?? configuredAppUrl;

/** Escape text interpolated into email HTML (user-controlled display names). */
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
	trustedOrigins: [configuredAppUrl, vercelPreviewUrl].filter(
		(origin): origin is string => Boolean(origin),
	),
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // 1 day
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 minutes
		},
	},
	rateLimit: {
		enabled: true,
		window: 60,
		max: 20,
		// Counters in Postgres rather than Better Auth's default per-instance
		// Map — a limit that multiplies by the number of warm serverless
		// instances is not a limit. See server/rate-limit.ts.
		customStorage: rateLimitStorage,
	},
	advanced: {
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
			// and ending alphanumeric — same rule as repository names.
			usernameValidator: (name) => STORAGE_NAME_RE.test(name),
		}),
	],
});
