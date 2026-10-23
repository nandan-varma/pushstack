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
	matches: (path: string, budget?: MatchBudget) => boolean;
}

const USERNAME = /^@([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)$/;

/** Longest pattern, most rules and longest path considered; beyond them nothing matches. */
export const MAX_PATTERN_CHARS = 256;
export const MAX_CODEOWNERS_RULES = 1000;
const MAX_PATH_CHARS = 1024;

type Token =
	| { t: "char"; c: string }
	| { t: "any1" } // ?  : one non-slash character
	| { t: "star" } // *  : any run of non-slash characters
	| { t: "globstar" } // ** : any run of characters
	| { t: "globdir" }; // **/ : nothing, or any characters ending in a slash

/** A shared work allowance so many rules x many paths cannot pin the server. */
export interface MatchBudget {
	cells: number;
}

/**
 * Compile one CODEOWNERS pattern into a matcher over repo-relative paths.
 *
 * Matching is a dynamic program over (pattern token, path position), never a
 * regex, so its cost is bounded by tokens x path length whatever wildcards the
 * pattern holds.
 */
export function compilePattern(
	pattern: string,
): (path: string, budget?: MatchBudget) => boolean {
	if (pattern.length > MAX_PATTERN_CHARS || /[![\]\\]/.test(pattern)) {
		return () => false;
	}
	const dirOnly = pattern.endsWith("/");
	const body = dirOnly ? pattern.slice(0, -1) : pattern;
	if (body === "") return () => false;
	const anchored = body.includes("/");
	const trimmed = body.startsWith("/") ? body.slice(1) : body;
	const lastSegment = trimmed.slice(trimmed.lastIndexOf("/") + 1);

	const tokens: Token[] = anchored ? [] : [{ t: "globdir" }];
	for (let i = 0; i < trimmed.length; i++) {
		const char = trimmed[i] as string;
		if (char === "*") {
			if (trimmed[i + 1] === "*") {
				const atStart = i === 0 || trimmed[i - 1] === "/";
				while (trimmed[i + 1] === "*") i++;
				if (trimmed[i + 1] === "/" && atStart) {
					tokens.push({ t: "globdir" });
					i++;
				} else {
					tokens.push({ t: "globstar" });
				}
			} else {
				tokens.push({ t: "star" });
			}
		} else if (char === "?") {
			tokens.push({ t: "any1" });
		} else {
			tokens.push({ t: "char", c: char });
		}
	}
	// A matched directory owns everything beneath it, but a wildcard last
	// segment (`docs/*`) stops at the directory's direct children, as on GitHub.
	const descends = dirOnly || !/[*?]/.test(lastSegment);

	return (path, budget) => {
		const n = path.length;
		if (n > MAX_PATH_CHARS) return false;
		if (budget) {
			budget.cells -= (tokens.length + 1) * (n + 1);
			if (budget.cells < 0) return false;
		}
		let cur = new Uint8Array(n + 1);
		cur[0] = 1;
		for (const token of tokens) {
			const next = new Uint8Array(n + 1);
			switch (token.t) {
				case "char":
					for (let j = 0; j < n; j++) {
						if (cur[j] && path[j] === token.c) next[j + 1] = 1;
					}
					break;
				case "any1":
					for (let j = 0; j < n; j++) {
						if (cur[j] && path[j] !== "/") next[j + 1] = 1;
					}
					break;
				case "star":
				case "globstar":
					for (let j = 0; j <= n; j++) {
						next[j] =
							cur[j] ||
							(j > 0 &&
							next[j - 1] &&
							(token.t === "globstar" || path[j - 1] !== "/")
								? 1
								: 0);
					}
					break;
				case "globdir": {
					let seen = 0;
					for (let j = 0; j <= n; j++) {
						next[j] = cur[j] || (j > 0 && path[j - 1] === "/" && seen) ? 1 : 0;
						if (cur[j]) seen = 1;
					}
					break;
				}
			}
			cur = next;
		}
		for (let j = 0; j <= n; j++) {
			if (!cur[j]) continue;
			if (j === n ? !dirOnly : descends && path[j] === "/") return true;
		}
		return false;
	};
}

export function parseCodeowners(text: string): CodeownersRule[] {
	const rules: CodeownersRule[] = [];
	const lines = text.split(/\r?\n/);
	for (const [index, raw] of lines.entries()) {
		if (rules.length >= MAX_CODEOWNERS_RULES) break;
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
	budget?: MatchBudget,
): CodeownersRule | undefined {
	for (let i = rules.length - 1; i >= 0; i--) {
		const rule = rules[i];
		if (rule?.matches(path, budget)) return rule;
	}
	return undefined;
}

/** Owners of every path, deduplicated, in first-seen order. */
export function ownersOfPaths(
	rules: CodeownersRule[],
	paths: string[],
): string[] {
	const owners = new Set<string>();
	const budget: MatchBudget = { cells: 100_000_000 };
	for (const path of paths) {
		for (const owner of ruleFor(rules, path, budget)?.owners ?? [])
			owners.add(owner);
	}
	return [...owners];
}
