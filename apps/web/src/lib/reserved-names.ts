/**
 * Top-level path segments that can never be a username. Users live at
 * `/{owner}` and repositories at `/{owner}/{repo}`, like GitHub, so a user
 * named after a static route or a public file would be unreachable (or would
 * shadow it). Client-safe: the sign-up form and the server share it.
 *
 * `reserved-names.test.ts` checks that every top-level route and public file
 * is listed; GitHub's own reservations are added so imported links behave.
 */
const RESERVED = new Set([
	// App routes (src/routes) and server paths.
	"about",
	"api",
	"assets",
	"auth",
	"dashboard",
	"repo",
	"repositories",
	"search",
	"settings",
	"users",
	// Public files (public/).
	"apple-touch-icon.png",
	"favicon.ico",
	"favicon.svg",
	"logo192.png",
	"logo512.png",
	"manifest.json",
	"maskable-icon-512.png",
	"og-image.png",
	"robots.txt",
	"sitemap.xml",
	// GitHub's top-level paths.
	"account",
	"admin",
	"contact",
	"explore",
	"features",
	"help",
	"issues",
	"login",
	"logout",
	"marketplace",
	"new",
	"notifications",
	"organizations",
	"orgs",
	"pricing",
	"pulls",
	"security",
	"signup",
	"site",
	"sponsors",
	"topics",
	"trending",
]);

/** Whether `name` is a reserved top-level path (case-insensitive). */
export function isReservedName(name: string) {
	return RESERVED.has(name.toLowerCase());
}
