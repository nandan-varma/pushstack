/**
 * Resolving a markdown link/image target against the file it was written in.
 *
 * A relative target in markdown is relative to the containing document, the
 * same as on GitHub: `./diagram.png` written in `docs/README.md` names
 * `docs/diagram.png`, not `diagram.png`. Targets here are repository-relative
 * paths rather than filesystem paths, so the only work to do is normalizing
 * `.`/`..` and refusing a target that climbs above the repository root.
 */

function directoryOf(filePath: string): string {
	const slash = filePath.lastIndexOf("/");
	return slash === -1 ? "" : filePath.slice(0, slash);
}

/**
 * `target` resolved against `fromFile` as a repository-relative path, or `null`
 * when it climbs above the repository root (`../../x` from a root-level file) —
 * no repository contains such a path, so callers must not invent one.
 *
 * A target starting with `/` is already repository-absolute and ignores
 * `fromFile`, matching how markdown treats a root-relative URL.
 */
export function resolveRepoRelativePath(
	fromFile: string,
	target: string,
): string | null {
	const segments = target.startsWith("/")
		? []
		: directoryOf(fromFile).split("/").filter(Boolean);

	for (const segment of target.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		segments.push(segment);
	}

	return segments.join("/");
}
