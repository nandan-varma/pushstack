/**
 * The typed schema for a wiki page slug. The rules themselves live in
 * `wiki-slug.ts`, which browser code can import without pulling zod in.
 */
import { z } from "zod";
import { MAX_WIKI_PAGE_NAME_CHARS } from "@/lib/limits";
import { isSafeWikiPageName, pageNameFromSlug } from "@/lib/wiki-slug";

export const safeWikiPageSchema = z
	.string()
	.min(1)
	.max(MAX_WIKI_PAGE_NAME_CHARS)
	.transform(pageNameFromSlug)
	.refine(isSafeWikiPageName, "Invalid wiki page name");
