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

const APP_URL = process.env.BETTER_AUTH_URL ?? "https://git.nandan.fyi";

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
	trustedOrigins: [APP_URL].filter(Boolean),
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
