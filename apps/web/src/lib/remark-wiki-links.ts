/**
 * remark plugin: `[[Page]]` and `[[Page|label]]` become links to that wiki
 * page. Wiki bodies are attacker-writable by any signed-in user on a public
 * repository, so every target is a validated page slug percent-encoded into a
 * path under `linkBase` — never a URL the page text chose.
 */
import { findAndReplace } from "mdast-util-find-and-replace";
import { isSafeWikiPageName, pageSlugFromTitle } from "@/lib/wiki-slug";

const WIKI_LINK_PATTERN = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;

export function createWikiLinksPlugin(linkBase: string) {
	return () => (tree: Parameters<typeof findAndReplace>[0]) => {
		findAndReplace(
			tree,
			[
				WIKI_LINK_PATTERN,
				(_full: string, target: string, label?: string) => {
					const page = pageSlugFromTitle(target);
					if (!isSafeWikiPageName(page)) return false;
					return {
						type: "link" as const,
						url: `${linkBase}/${encodeURIComponent(page)}`,
						children: [
							{ type: "text" as const, value: (label ?? target).trim() },
						],
					};
				},
			],
			{ ignore: ["link", "linkReference", "code", "inlineCode"] },
		);
	};
}
