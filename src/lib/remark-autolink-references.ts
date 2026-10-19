import { findAndReplace } from "mdast-util-find-and-replace";
import {
	createMarkdownReferencePattern,
	type ResolveReference,
} from "@/lib/reference-patterns";
import { STORAGE_NAME_RE } from "@/lib/storage-name";

export interface AutolinkReferencesOptions {
	/** The repository being rendered; without it only `@mentions` link. */
	owner?: string;
	name?: string;
	resolveReference?: ResolveReference;
}

function link(url: string, text: string) {
	return {
		type: "link" as const,
		url,
		children: [{ type: "text" as const, value: text }],
	};
}

const isName = (value: string) => STORAGE_NAME_RE.test(value);

/**
 * remark plugin: turns GitHub-style references found in text nodes into links
 * — `@user`, `#N`, `owner/repo#N`, commit SHAs and `owner/repo@sha`. Text
 * inside code spans/fences (never `text` nodes) and existing links (including
 * GFM bare-URL autolinks; find-and-replace descends into links unless told
 * to ignore them) is untouched.
 *
 * Every URL is built from segments that passed `STORAGE_NAME_RE` or are
 * digits/hex, so none can carry a scheme; MarkdownRenderer's anchor renderers
 * still run `isSafeHref` on the result.
 */
export function createAutolinkReferencesPlugin(
	options: AutolinkReferencesOptions = {},
) {
	const { owner, name, resolveReference } = options;

	const sameRepo = (o: string, n: string) =>
		owner !== undefined &&
		name !== undefined &&
		o.toLowerCase() === owner.toLowerCase() &&
		n.toLowerCase() === name.toLowerCase();

	function numberLink(o: string, n: string, num: number, text: string) {
		let segment = "issues";
		// Issues and pull requests have separate sequences here; for this
		// repository only link what is unambiguously known. Another repository's
		// numbers aren't loaded, so its `#N` goes to the issue page.
		if (sameRepo(o, n)) {
			const kind = resolveReference?.(num);
			if (!kind) return false;
			if (kind === "pull") segment = "pulls";
		}
		return link(`/repo/${o}/${n}/${segment}/${num}`, text);
	}

	return () => (tree: Parameters<typeof findAndReplace>[0]) => {
		findAndReplace(
			tree,
			[
				createMarkdownReferencePattern(),
				(
					full: string,
					xOwner?: string,
					xRepo?: string,
					xNum?: string,
					sOwner?: string,
					sRepo?: string,
					sSha?: string,
					num?: string,
					login?: string,
					sha?: string,
				) => {
					if (login !== undefined) {
						return isName(login) ? link(`/users/${login}`, full) : false;
					}
					if (xOwner !== undefined && xRepo !== undefined && xNum) {
						if (!isName(xOwner) || !isName(xRepo)) return false;
						return numberLink(xOwner, xRepo, Number(xNum), full);
					}
					if (sOwner !== undefined && sRepo !== undefined && sSha) {
						if (!isName(sOwner) || !isName(sRepo)) return false;
						return link(`/repo/${sOwner}/${sRepo}/commit/${sSha}`, full);
					}
					if (owner === undefined || name === undefined) return false;
					if (num !== undefined) {
						return numberLink(owner, name, Number(num), full);
					}
					if (sha !== undefined) {
						return link(
							`/repo/${owner}/${name}/commit/${sha}`,
							sha.slice(0, 7),
						);
					}
					return false;
				},
			],
			{ ignore: ["link", "linkReference"] },
		);
	};
}
