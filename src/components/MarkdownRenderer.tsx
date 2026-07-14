import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { type ComponentPropsWithoutRef, useMemo, useRef } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import {
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
} from "@/lib/query-options";
import type { ReferenceKind, ResolveReference } from "@/lib/reference-patterns";
import { createAutolinkReferencesPlugin } from "@/lib/remark-autolink-references";

interface MarkdownRendererProps {
	content: string;
	className?: string;
	owner?: string;
	name?: string;
	branch?: string;
	repoId?: number;
}

const REFERENCE_LINK_RE =
	/^\/repo\/([^/]+)\/([^/]+)\/(commit|issues|pulls)\/(.+)$/;

function isExternalLink(href: string): boolean {
	return /^(https?:\/\/|mailto:|#)/.test(href);
}

// Markdown link/image targets come from repo READMEs, issue bodies, PR bodies,
// and comments — all attacker-writable by anyone with write access (or, for
// public repos, anyone who can comment). Without this, a link like
// `[click](javascript:fetch(...))` rendered as a raw `<a href>` would execute
// in the viewer's session on click. Only allow schemeless (relative) hrefs or
// an explicit http(s)/mailto scheme — anything else (javascript:, data:,
// vbscript:, ...) is rejected outright rather than trying to blocklist every
// dangerous scheme individually.
export function isSafeHref(href: string): boolean {
	const trimmed = href.trim();
	if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
	return /^(https?|mailto):/i.test(trimmed);
}

// Images can't execute a data: URI (unlike anchors, where data:text/html is a
// real navigation risk), so inline base64 images — a common, legitimate case
// in READMEs — stay allowed here even though isSafeHref rejects data: for links.
export function isSafeImageSrc(src: string): boolean {
	return isSafeHref(src) || /^data:image\//i.test(src.trim());
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
				className="absolute top-2 right-2 rounded-md border border-[var(--chip-line)] bg-[var(--card-bg)] p-1.5 text-[var(--sea-ink-soft)] opacity-0 transition-opacity hover:text-[var(--sea-ink)] group-hover:opacity-100 focus-visible:opacity-100"
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

function buildComponents(
	owner?: string,
	name?: string,
	branch?: string,
): Components {
	const base: Components = { pre: CodeBlock };
	if (!owner || !name) return base;

	return {
		...base,
		a: ({ href, children, ...props }) => {
			if (!href) return <>{children}</>;

			if (isExternalLink(href)) {
				return (
					<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
						{children}
					</a>
				);
			}

			const refMatch = href.match(REFERENCE_LINK_RE);
			if (refMatch) {
				const [, refOwner, refName, kind, refId] = refMatch;
				if (kind === "commit") {
					return (
						<Link
							to="/repo/$owner/$name/commit/$sha"
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
								? "/repo/$owner/$name/pulls/$id"
								: "/repo/$owner/$name/issues/$id"
						}
						params={{ owner: refOwner, name: refName, id: refId }}
						{...props}
					>
						{children}
					</Link>
				);
			}

			if (!branch) {
				if (!isSafeHref(href)) return <>{children}</>;
				return (
					<a href={href} {...props}>
						{children}
					</a>
				);
			}
			const cleanHref = href.replace(/^\.\//, "").replace(/^\//, "");
			return (
				<Link
					to="/repo/$owner/$name/blob/$branch/$"
					params={{ owner, name, branch, _splat: cleanHref }}
					{...props}
				>
					{children}
				</Link>
			);
		},
		img: ({ src, alt, ...props }) => {
			if (!src) return null;
			if (!isSafeImageSrc(src)) return null;
			if (isExternalLink(src) || /^data:/i.test(src.trim()) || !branch) {
				return <img src={src} alt={alt ?? ""} {...props} />;
			}
			const cleanSrc = src.replace(/^\.\//, "").replace(/^\//, "");
			return (
				<img
					src={`/api/repos/${owner}/${name}/blob/${branch}/${cleanSrc}`}
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
	repoId,
}: MarkdownRendererProps) {
	const components = useMemo(
		() => buildComponents(owner, name, branch),
		[owner, name, branch],
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
		const issueSet = new Set(issueNumbers ?? []);
		const prSet = new Set(prNumbers ?? []);
		return (num: number): ReferenceKind | null => {
			if (prSet.has(num)) return "pull";
			if (issueSet.has(num)) return "issue";
			return null;
		};
	}, [issueNumbers, prNumbers]);

	const remarkPlugins = useMemo(() => {
		if (!owner || !name) return [remarkGfm];
		return [
			remarkGfm,
			createAutolinkReferencesPlugin({ owner, name, resolveReference }),
		];
	}, [owner, name, resolveReference]);

	return (
		<div
			className={`prose prose-slate dark:prose-invert max-w-none ${className}`}
		>
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				rehypePlugins={[rehypeHighlight]}
				components={components}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
