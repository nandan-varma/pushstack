import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
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
	return /^(https?:\/\/|mailto:|data:|#)/.test(href);
}

function buildComponents(
	owner?: string,
	name?: string,
	branch?: string,
): Components {
	if (!owner || !name) return {};

	return {
		a: ({ href, children, ...props }) => {
			if (!href || isExternalLink(href)) {
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
			if (!src || isExternalLink(src) || !branch) {
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
