/**
 * Wiki page names, as pure functions. Kept apart from `wiki-page.ts`'s zod
 * schema because the markdown renderer runs in the browser and needs the same
 * rules: importing the schema module there would ship zod to every route that
 * can render a comment or a README.
 *
 * A wiki page is one markdown file in the wiki's root tree: the slug in
 * `/…/wiki/{Page}` is the file name without `.md` (`Getting-Started.md`).
 */
import { MAX_WIKI_PAGE_NAME_CHARS } from "@/lib/limits";

/** Page names the web routes take for actions, so a page cannot use them. */
const RESERVED_WIKI_PAGE_NAMES = new Set(["_new", "_edit", "_history"]);

/** Chrome files that live beside the pages but are not pages themselves. */
export const WIKI_CHROME_FILES = new Set(["_Sidebar.md", "_Footer.md"]);

const UNSAFE_WIKI_PAGE_CHARS = /[/\\\p{Cc}]/u;

/** A URL slug names its file without the markdown extension. */
export function pageNameFromSlug(slug: string): string {
	return slug.endsWith(".md") ? slug.slice(0, -3) : slug;
}

/** The file a page name names in the wiki's root tree. */
export function pageFileName(name: string): string {
	return `${name}.md`;
}

/** The rule a page name must satisfy before any git path is built from it. */
export function isSafeWikiPageName(name: string): boolean {
	return (
		name.length > 0 &&
		name.length <= MAX_WIKI_PAGE_NAME_CHARS &&
		name === name.trim() &&
		!name.startsWith(".") &&
		!name.includes("..") &&
		!UNSAFE_WIKI_PAGE_CHARS.test(name) &&
		!RESERVED_WIKI_PAGE_NAMES.has(name)
	);
}

/** `[[Second Page]]` names `Second-Page.md`. */
export function pageSlugFromTitle(title: string): string {
	return pageNameFromSlug(title.trim().replace(/\s+/g, "-"));
}
