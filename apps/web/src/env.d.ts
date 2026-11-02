/**
 * Optional configuration `wrangler types` cannot infer: it is absent from
 * wrangler.jsonc when a deployment does not use the feature. Set a variable
 * under `vars` (public) or with `wrangler secret put` (private).
 */
/**
 * Positive-integer limits and budgets read by src/server/config.ts, as the
 * strings a Worker variable holds. Unset means the default in that file.
 */
interface Tunables {
	GIT_CACHE_MAX_SIZE?: string;
	GIT_CACHE_TTL?: string;
	GIT_HTTP_MAX_BODY_BYTES?: string;
	SLOW_REQUEST_MS?: string;
	RATE_LIMIT_WINDOW_SECONDS?: string;
	RATE_LIMIT_API_ANONYMOUS?: string;
	RATE_LIMIT_API_AUTHENTICATED?: string;
	RATE_LIMIT_API_WRITE?: string;
	RATE_LIMIT_AUTH_FAILURES?: string;
	RATE_LIMIT_DEVICE_CODE?: string;
	RATE_LIMIT_DEVICE_USER_CODE_IP?: string;
	RATE_LIMIT_DEVICE_USER_CODE_USER?: string;
	RATE_LIMIT_FORKS_USER?: string;
	RATE_LIMIT_GIT_READ_ANONYMOUS?: string;
	RATE_LIMIT_GIT_READ_AUTHENTICATED?: string;
	RATE_LIMIT_GIT_WRITE?: string;
	RATE_LIMIT_OAUTH_TOKEN_CLIENT?: string;
	RATE_LIMIT_OAUTH_TOKEN_IP?: string;
}

declare namespace Cloudflare {
	interface Env extends Tunables {
		/** Public Sentry DSN; without one nothing reports. Also read at build time. */
		VITE_SENTRY_DSN?: string;
		/**
		 * The bucket's S3 API credentials, used only to presign browser uploads
		 * (src/lib/r2.ts); without them uploads use the request body instead.
		 */
		R2_ACCESS_KEY_ID?: string;
		R2_SECRET_ACCESS_KEY?: string;
		RESEND_API_KEY?: string;
		RESEND_EMAIL_FROM?: string;
		/** Server-side performance logging: "1" turns it on. */
		PUSHSTACK_PERF_LOG?: string;
	}
}

// `wrangler types` is run without the Workers runtime types, which would clash
// with the DOM and Node ones the rest of the app compiles against. The
// binding's type is the structural slice git-fs-s3 needs, which R2's real
// binding satisfies.
type R2Bucket = import("git-fs-s3/r2").R2BucketLike;

declare module "cloudflare:workers" {
	export const env: Cloudflare.Env;
}

// D1's binding type, declared structurally for the same reason as R2Bucket
// above. It is the slice drizzle's D1 driver (`AnyD1Database`) and the tests'
// Miniflare database both satisfy.
interface D1Result<T = unknown> {
	results: T[];
	success: boolean;
	meta: Record<string, unknown>;
}

interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = unknown>(): Promise<T | null>;
	run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

interface D1Database {
	prepare(query: string): D1PreparedStatement;
	batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
	exec(query: string): Promise<{ count: number; duration: number }>;
}
