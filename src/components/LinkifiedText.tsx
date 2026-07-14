import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
	createReferencePattern,
	type ResolveReference,
} from "@/lib/reference-patterns";

/**
 * Renders plain text (e.g. a commit message) with `#123` and commit SHA
 * references turned into links, without interpreting the rest as markdown —
 * matches how GitHub autolinks commit messages while leaving formatting alone.
 */
export function LinkifiedText({
	text,
	owner,
	name,
	resolveReference,
	className,
}: {
	text: string;
	owner: string;
	name: string;
	resolveReference?: ResolveReference;
	className?: string;
}) {
	const nodes = useMemo(() => {
		const pattern = createReferencePattern();
		const result: ReactNode[] = [];
		let lastIndex = 0;
		let key = 0;

		for (const match of text.matchAll(pattern)) {
			const index = match.index ?? 0;
			const full = match[0];
			const refNum = match[1];

			if (index > lastIndex) {
				result.push(text.slice(lastIndex, index));
			}

			if (refNum !== undefined) {
				const num = Number(refNum);
				const kind = resolveReference?.(num);
				if (kind) {
					result.push(
						<Link
							key={`ref-${key++}`}
							to={
								kind === "pull"
									? "/repo/$owner/$name/pulls/$id"
									: "/repo/$owner/$name/issues/$id"
							}
							params={{ owner, name, id: String(num) }}
							className="font-medium text-[var(--lagoon-deep)] hover:underline"
						>
							{full}
						</Link>,
					);
				} else {
					result.push(full);
				}
			} else {
				result.push(
					<Link
						key={`sha-${key++}`}
						to="/repo/$owner/$name/commit/$sha"
						params={{ owner, name, sha: full }}
						className="rounded bg-[var(--chip-bg)] px-1 font-mono text-[var(--lagoon-deep)] hover:underline"
					>
						{full.slice(0, 7)}
					</Link>,
				);
			}

			lastIndex = index + full.length;
		}

		if (lastIndex < text.length) {
			result.push(text.slice(lastIndex));
		}

		return result;
	}, [text, owner, name, resolveReference]);

	return <span className={className}>{nodes}</span>;
}
