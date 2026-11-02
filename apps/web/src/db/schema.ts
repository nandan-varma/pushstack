import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Better Auth's tables, maintained by hand: diff against its core schema
// (@better-auth/core's get-tables) before bumping better-auth.
export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
	image: text("image"),
	createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
	updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
	username: text("username").notNull().unique(),
	displayUsername: text("displayUsername"),
	// GitHub-style integer id for /api/v3 clients. Not a Better Auth field: an
	// AFTER INSERT trigger in the migrations assigns the next value (a default of
	// 0 only stands in until it fires).
	apiId: integer("apiId").notNull().unique().default(0),
});

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
		ipAddress: text("ipAddress"),
		userAgent: text("userAgent"),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => ({
		// SQLite does not auto-index foreign key columns — session revocation
		// ("log out everywhere") looks up all sessions by userId.
		userIdx: index("session_user_idx").on(table.userId),
	}),
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("accountId").notNull(),
		providerId: text("providerId").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("accessToken"),
		refreshToken: text("refreshToken"),
		idToken: text("idToken"),
		accessTokenExpiresAt: integer("accessTokenExpiresAt", {
			mode: "timestamp_ms",
		}),
		refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
			mode: "timestamp_ms",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		// git-auth.ts's password-auth path looks up the credential account by
		// userId on every Basic-Auth git request — without this it's a full
		// table scan of `account`.
		userIdx: index("account_user_idx").on(table.userId),
	}),
);

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
	createdAt: integer("createdAt", { mode: "timestamp_ms" }),
	updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
});
