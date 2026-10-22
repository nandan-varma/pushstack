import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { type ComponentPropsWithoutRef, useMemo, useRef } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { rawFileUrl } from "@/lib/file-view";
import {
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
} from "@/lib/query-options";
import type { ResolveReference } from "@/lib/reference-patterns";
import { createReferenceResolver } from "@/lib/reference-patterns";
import { createAutolinkReferencesPlugin } from "@/lib/remark-autolink-references";
import { resolveRepoRelativePath } from "@/lib/repo-path";

interface MarkdownRendererProps {
	content: string;
	className?: string;
	owner?: string;
	name?: string;
	branch?: string;
	/** The file this content came from, for resolving its relative links. */
	filePath?: string;
	repoId?: number;
}

import { isReservedName } from "@/lib/reserved-names";

const REFERENCE_LINK_RE = /^\/([^/]+)\/([^/]+)\/(commit|issues|pulls)\/(.+)$/;

const USER_LINK_RE = /^\/([^/]+)$/;

function isExternalLink(href: string): boolean {
	return /^(https?:\/\/|mailto:)/.test(href);
}

// Markdown link/image targets come from repo READMEs, issue bodies, PR bodies,
// and comments — all attacker-writable by anyone with write access (or, for
// public repos, anyone who can comment). A `javascript:` href reaching a real
// `<a href>` executes in the viewer's session on click.
//
// So these predicates answer exactly one question — does this value have a
// scheme I allow? — and they must answer it the way the browser's URL parser
// will, not the way the value's literal prefix looks. That parser removes
// every ASCII tab and newline from its input and strips leading C0 controls
// and spaces *before* it reads the scheme, so a value whose prefix looks
// schemeless can still be a live `javascript:` URL: both
// `java\tscript:alert(1)` and `\u0001javascript:alert(1)` normalize to
// `javascript:alert(1)`. A prefix-anchored scheme test is therefore not a
// check on what the browser will do.
//
// Rather than enumerate which characters the parser happens to strip, any
// value containing a C0 control or a space is rejected outright, and only then
// is the scheme allowlisted. Nothing legitimate is lost: a markdown
// destination cannot carry a raw control character or space in the first
// place — the markdown parser percent-encodes them before this ever sees the
// value.

// biome-ignore lint/suspicious/noControlCharactersInRegex: the C0 range is exactly what the URL parser strips before it reads a scheme, so this check has to match those code points.
const URL_UNSAFE_CHARS = /[\u0000-\u0020\u007f]/;

const URL_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

const SAFE_URL_SCHEMES: ReadonlySet<string> = new Set([
	"http",
	"https",
	"mailto",
]);

function hasSafeScheme(value: string, allowDataImage: boolean): boolean {
	if (URL_UNSAFE_CHARS.test(value)) return false;
	const scheme = URL_SCHEME_RE.exec(value)?.[1]?.toLowerCase();
	// No scheme at all: a relative reference, which resolves within this origin
	// (a protocol-relative `//host/x` resolves to another origin but is still
	// only ever a link or an image, never script).
	if (scheme === undefined) return true;
	// An `<img src="data:...">` cannot execute script the way an
	// `<a href="data:text/html,...">` navigation can, so inline base64 images —
	// a common, legitimate README case — are allowed for images and only for
	// image types.
	if (scheme === "data") return allowDataImage && /^data:image\//i.test(value);
	return SAFE_URL_SCHEMES.has(scheme);
}

export function isSafeHref(href: string): boolean {
	return hasSafeScheme(href, false);
}

export function isSafeImageSrc(src: string): boolean {
	return hasSafeScheme(src, true);
}

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
	const preRef = useRef<HTMLPreElement>(null);
	const { copied, copy } = useCopyToClipboard();

	return (
		<div className="group relative">
			<pre ref={preRef} {...props}>
				{children}
			</pre>
			<button
				type="button"
				onClick={() => copy(preRef.current?.textContent ?? "")}
				aria-label={copied ? "Copied" : "Copy code"}
				className="absolute top-2 right-2 rounded-[8px] border border-bjork-border bg-bjork-surface p-1.5 text-bjork-text-soft shadow-(--bjork-shadow-soft) transition-[opacity,color] hover:text-bjork-text focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
			>
				{copied ? (
					<Check className="size-3.5" />
				) : (
					<Copy className="size-3.5" />
				)}
			</button>
		</div>
	);
}

/**
 * Heading ids carry GitHub's `user-content-` prefix (so user content can't
 * clobber DOM globals); an in-document `#section` link targets that id, so the
 * browser's own jump works with no script.
 */
const HEADING_ID_PREFIX = "user-content-";
function fragmentAnchor(
	href: string,
	children: React.ReactNode,
	props: object,
) {
	const fragment = href.slice(1);
	const target = fragment.startsWith(HEADING_ID_PREFIX)
		? fragment
		: `${HEADING_ID_PREFIX}${fragment}`;
	return (
		<a href={`#${target}`} {...props}>
			{children}
		</a>
	);
}

// Fallback anchor/image renderers for the paths without owner/name context.
// Every render path goes through isSafeHref/isSafeImageSrc; the
// owner+name-aware renderers below are not a stricter alternative to these.
const safeAnchor: Components["a"] = ({ href, children, ...props }) => {
	if (!href || !isSafeHref(href)) return <>{children}</>;
	if (href.startsWith("#")) return fragmentAnchor(href, children, props);
	if (isExternalLink(href)) {
		return (
			<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
				{children}
			</a>
		);
	}
	return (
		<a href={href} {...props}>
			{children}
		</a>
	);
};

const safeImg: Components["img"] = ({ src, alt, ...props }) => {
	if (!src || !isSafeImageSrc(src)) return null;
	return <img src={src} alt={alt ?? ""} {...props} />;
};

function buildComponents(
	owner?: string,
	name?: string,
	branch?: string,
	filePath = "",
): Components {
	const base: Components = { pre: CodeBlock, a: safeAnchor, img: safeImg };
	if (!owner || !name) return base;

	return {
		...base,
		a: ({ href, children, ...props }) => {
			if (!href) return <>{children}</>;
			if (href.startsWith("#")) return fragmentAnchor(href, children, props);

			if (isExternalLink(href)) {
				return (
					<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
						{children}
					</a>
				);
			}
			if (!isSafeHref(href)) return <>{children}</>;

			const userMatch = href.match(USER_LINK_RE);
			if (userMatch?.[1] && !isReservedName(userMatch[1])) {
				return (
					<Link to="/$owner" params={{ owner: userMatch[1] }} {...props}>
						{children}
					</Link>
				);
			}

			const refMatch = href.match(REFERENCE_LINK_RE);
			if (refMatch?.[1] && !isReservedName(refMatch[1])) {
				const [, refOwner, refName, kind, refId] = refMatch;
				if (kind === "commit") {
					return (
						<Link
							to="/$owner/$name/commit/$sha"
							params={{ owner: refOwner, name: refName, sha: refId }}
							{...props}
						>
							{children}
						</Link>
					);
				}
				return (
					<Link
						to={
							kind === "pulls"
								? "/$owner/$name/pulls/$id"
								: "/$owner/$name/issues/$id"
						}
						params={{ owner: refOwner, name: refName, id: refId }}
						{...props}
					>
						{children}
					</Link>
				);
			}

			// A href that qualified a scheme but isn't the external shape handled
			// above (mailto:, http: without slashes) is a real URL, not a path in
			// this repository; so is any href when there is no branch to browse.
			if (URL_SCHEME_RE.test(href) || !branch) {
				return (
					<a href={href} {...props}>
						{children}
					</a>
				);
			}

			const target = resolveRepoRelativePath(filePath, href);
			// A relative target that climbs above the repository root is not a
			// path that exists; render the text rather than invent one.
			if (target === null) return <>{children}</>;
			return (
				<Link
					to="/$owner/$name/blob/$branch/$"
					params={{ owner, name, branch, _splat: target }}
					{...props}
				>
					{children}
				</Link>
			);
		},
		img: ({ src, alt, ...props }) => {
			if (!src || !isSafeImageSrc(src)) return null;
			if (URL_SCHEME_RE.test(src) || !branch) {
				return <img src={src} alt={alt ?? ""} {...props} />;
			}
			const target = resolveRepoRelativePath(filePath, src);
			if (target === null) return null;
			return (
				<img
					src={rawFileUrl({ owner, name, ref: branch, path: target })}
					alt={alt ?? ""}
					{...props}
				/>
			);
		},
	};
}

export default function MarkdownRenderer({
	content,
	className = "",
	owner,
	name,
	branch,
	filePath = "",
	repoId,
}: MarkdownRendererProps) {
	const components = useMemo(
		() => buildComponents(owner, name, branch, filePath),
		[owner, name, branch, filePath],
	);

	const { data: issueNumbers } = useQuery({
		...repositoryIssueNumbersQueryOptions(repoId ?? 0),
		enabled: !!repoId,
	});
	const { data: prNumbers } = useQuery({
		...repositoryPullRequestNumbersQueryOptions(repoId ?? 0),
		enabled: !!repoId,
	});

	const resolveReference: ResolveReference | undefined = useMemo(() => {
		if (!issueNumbers && !prNumbers) return undefined;
		return createReferenceResolver(issueNumbers ?? [], prNumbers ?? []);
	}, [issueNumbers, prNumbers]);

	const remarkPlugins = useMemo(
		() => [
			remarkGfm,
			createAutolinkReferencesPlugin({ owner, name, resolveReference }),
		],
		[owner, name, resolveReference],
	);

	return (
		<div className={`markdown-body ${className}`}>
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				rehypePlugins={[
					[rehypeSlug, { prefix: HEADING_ID_PREFIX }],
					rehypeHighlight,
				]}
				components={components}
				// react-markdown's own default urlTransform blocks any scheme
				// outside (https?|ircs?|mailto|xmpp) — including data:, which
				// silently broke isSafeImageSrc's inline-base64-image allowance
				// (it never got a chance to run: the src was already emptied
				// out before reaching our `img` renderer). That leaves
				// isSafeHref/isSafeImageSrc as the decision layer for every
				// href/src — judging the value mdast has already percent-encoded,
				// which is why they cannot key off the literal prefix alone (see
				// their own comment).
				urlTransform={(value) => value}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
