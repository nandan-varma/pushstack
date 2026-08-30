import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db/index";
import { sendEmail } from "./email";

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

export const auth = betterAuth({
	database: drizzleAdapter(db, {
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
				html: `<p>Hi ${user.name ?? user.email},</p><p>Click <a href="${url}">here</a> to reset your password. This link expires in 1 hour.</p><p>If you didn't request this, you can ignore this email.</p>`,
			});
		},
	},
	emailVerification: {
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url }) => {
			await sendEmail({
				to: user.email,
				subject: "Verify your PushStack email",
				html: `<p>Hi ${user.name ?? user.email},</p><p>Click <a href="${url}">here</a> to verify your email address.</p>`,
			});
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
			maxUsernameLength: 30,
		}),
	],
});
