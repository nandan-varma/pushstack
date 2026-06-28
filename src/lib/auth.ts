import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db/index";

const authSecret = process.env.BETTER_AUTH_SECRET;

if (!authSecret) {
	throw new Error("BETTER_AUTH_SECRET environment variable is required");
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
	}),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false, // Set to true when email service is configured
		minPasswordLength: 8,
	},
	secret: authSecret,
	baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
	trustedOrigins: [
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://localhost:3001",
		"http://127.0.0.1:3001",
		process.env.BETTER_AUTH_URL,
	].filter(Boolean) as string[],
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // 1 day
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 minutes
		},
	},
	advanced: {
		cookiePrefix: "pushstack",
		useSecureCookies: process.env.NODE_ENV === "production",
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
