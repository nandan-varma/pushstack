import { findAndReplace } from "mdast-util-find-and-replace";
import {
	createReferencePattern,
	type ResolveReference,
} from "@/lib/reference-patterns";

export interface AutolinkReferencesOptions {
	owner: string;
	name: string;
	resolveReference?: ResolveReference;
}

/**
 * remark plugin: turns `#123` and commit SHAs found in text nodes into links.
 * Text inside code spans/fences and existing links is untouched — mdast only
 * ever hands find-and-replace plain `text` nodes.
 */
export function createAutolinkReferencesPlugin(
	options: AutolinkReferencesOptions,
) {
	const { owner, name, resolveReference } = options;

	return () => (tree: Parameters<typeof findAndReplace>[0]) => {
		findAndReplace(tree, [
			createReferencePattern(),
			(full: string, refNum: string | undefined) => {
				if (refNum !== undefined) {
					const num = Number(refNum);
					const kind = resolveReference?.(num);
					if (!kind) return false;
					const segment = kind === "pull" ? "pulls" : "issues";
					return {
						type: "link",
						url: `/repo/${owner}/${name}/${segment}/${num}`,
						children: [{ type: "text", value: full }],
					};
				}

				return {
					type: "link",
					url: `/repo/${owner}/${name}/commit/${full}`,
					children: [{ type: "text", value: full.slice(0, 7) }],
				};
			},
		]);
	};
}
