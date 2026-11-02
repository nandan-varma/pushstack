import { defineConfig } from "drizzle-kit";

// Only generates SQL migrations from the schema; they are applied to D1 with
// `wrangler d1 migrations apply` (`pnpm db:migrate:local` / `db:migrate:remote`).
export default defineConfig({
	out: "./migrations",
	schema: ["./src/db/schema.ts", "./src/db/app-schema.ts"],
	dialect: "sqlite",
});
