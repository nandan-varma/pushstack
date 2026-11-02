/**
 * The Worker's bindings, variables and secrets, typed by `worker-configuration.d.ts`
 * (`pnpm cf-typegen`, from wrangler.jsonc). Server code reads configuration
 * here and never from `process.env`: bindings such as the R2 bucket exist
 * nowhere else.
 *
 * Tests replace `cloudflare:workers` with src/test/cloudflare-workers.ts.
 */
export { env } from "cloudflare:workers";
