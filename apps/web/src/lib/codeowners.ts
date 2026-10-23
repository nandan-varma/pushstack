/**
 * CODEOWNERS parsing and matching with GitHub's rules (gitignore-style
 * patterns; the last matching line wins). Pure, shared by the server (review
 * auto-requests) and the blob view (owners of the viewed file).
 *
 * Only `@username` owners are kept: teams (`@org/team`) and bare e-mail
 * addresses cannot be resolved yet. Unsupported gitignore syntax (`!`, `[…]`,
 * `\#`) is rejected by GitHub too, so such a line matches nothing.
 */

/** Where GitHub looks for the file, in order; the first that exists is used. */
export const CODEOWNERS_PATHS = [
	".github/CODEOWNERS",
	"CODEOWNERS",
	"docs/CODEOWNERS",
] as const;

export interface CodeownersRule {
	pattern: string;
	/** Lower-cased usernames, in file order. */
	owners: string[];
	/** 1-based line number in the file. */
	line: number;
	matches: (path: string) => boolean;
}

const USERNAME = /^@([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)$/;

/** Compile one CODEOWNERS pattern into a matcher over repo-relative paths. */
export function compilePattern(pattern: string): (path: string) => boolean {
	if (/[![\]\\]/.test(pattern)) return () => false;
	const dirOnly = pattern.endsWith("/");
	const body = dirOnly ? pattern.slice(0, -1) : pattern;
	if (body === "") return () => false;
	const anchored = body.includes("/");
	const trimmed = body.startsWith("/") ? body.slice(1) : body;
	const lastSegment = trimmed.slice(trimmed.lastIndexOf("/") + 1);

	let source = "";
	for (let i = 0; i < trimmed.length; i++) {
		const char = trimmed[i] as string;
		if (char === "*") {
			if (trimmed[i + 1] === "*") {
				const atStart = i === 0 || trimmed[i - 1] === "/";
				i++;
				if (trimmed[i + 1] === "/" && atStart) {
					// `**/`: any number of leading directories (including none).
					source += "(?:.*/)?";
					i++;
				} else {
					source += ".*";
				}
			} else {
				source += "[^/]*";
			}
		} else if (char === "?") {
			source += "[^/]";
		} else {
			source += char.replace(/[.+^${}()|]/g, "\\$&");
		}
	}
	// A matched directory owns everything beneath it, but a wildcard last
	// segment (`docs/*`) stops at the directory's direct children, as on GitHub.
	const descends = !/[*?]/.test(lastSegment);
	const tail = dirOnly ? "/.*" : descends ? "(?:/.*)?" : "";
	const regex = new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}${tail}$`);
	return (path) => regex.test(path);
}

export function parseCodeowners(text: string): CodeownersRule[] {
	const rules: CodeownersRule[] = [];
	const lines = text.split(/\r?\n/);
	for (const [index, raw] of lines.entries()) {
		const content = raw.replace(/(^|\s)#.*$/, "").trim();
		if (!content) continue;
		const [pattern, ...rest] = content.split(/\s+/);
		if (!pattern) continue;
		const owners: string[] = [];
		for (const token of rest) {
			const match = USERNAME.exec(token);
			if (match?.[1]) owners.push(match[1].toLowerCase());
		}
		rules.push({
			pattern,
			owners,
			line: index + 1,
			matches: compilePattern(pattern),
		});
	}
	return rules;
}

/** The rule that owns `path`: the last one that matches. */
export function ruleFor(
	rules: CodeownersRule[],
	path: string,
): CodeownersRule | undefined {
	for (let i = rules.length - 1; i >= 0; i--) {
		const rule = rules[i];
		if (rule?.matches(path)) return rule;
	}
	return undefined;
}

/** Owners of every path, deduplicated, in first-seen order. */
export function ownersOfPaths(
	rules: CodeownersRule[],
	paths: string[],
): string[] {
	const owners = new Set<string>();
	for (const path of paths) {
		for (const owner of ruleFor(rules, path)?.owners ?? []) owners.add(owner);
	}
	return [...owners];
}
