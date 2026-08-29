import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

// Better Auth tables
export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("emailVerified").notNull(),
	image: text("image"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
	username: text("username").unique(),
	displayUsername: text("displayUsername"),
});

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expiresAt").notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("createdAt").notNull(),
		updatedAt: timestamp("updatedAt").notNull(),
		ipAddress: text("ipAddress"),
		userAgent: text("userAgent"),
		userId: text("userId")
			.notNull()
			.references(() => user.id),
	},
	(table) => ({
		// Postgres does not auto-index foreign key columns — session revocation
		// ("log out everywhere") looks up all sessions by userId.
		userIdx: index("session_user_idx").on(table.userId),
	}),
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("accountId").notNull(),
		providerId: text("providerId").notNull(),
		// Better Auth 1.7 core field — a stable per-provider identity namespace
		// (`local:<providerId>` for credential/local auth, `local:oauth:<providerId>`
		// for OAuth providers without their own issuer). Required by every
		// credential sign-in/sign-up call as of that version; added here to match
		// (was missing after the 1.6.22 -> 1.7.2 bump, breaking every login with
		// a "field does not exist in the schema" error — see security.md).
		issuer: text("issuer").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id),
		accessToken: text("accessToken"),
		refreshToken: text("refreshToken"),
		idToken: text("idToken"),
		accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
		refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("createdAt").notNull(),
		updatedAt: timestamp("updatedAt").notNull(),
	},
	(table) => ({
		// git-auth.ts's password-auth path looks up the credential account by
		// userId on every Basic-Auth git request — without this it's a full
		// table scan of `account`.
		userIdx: index("account_user_idx").on(table.userId),
		// Matches Better Auth 1.7's own core schema (get-tables.mjs): the
		// (issuer, accountId) pair is what actually identifies an account
		// uniquely, not (providerId, accountId) alone.
		issuerAccountIdx: uniqueIndex("account_issuer_account_id_idx").on(
			table.issuer,
			table.accountId,
		),
	}),
);

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expiresAt").notNull(),
	createdAt: timestamp("createdAt"),
	updatedAt: timestamp("updatedAt"),
});

// Export GitHub schema tables
export * from "./github-schema";
