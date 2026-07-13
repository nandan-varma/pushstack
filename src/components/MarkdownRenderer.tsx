import { Link } from "@tanstack/react-router";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
	content: string;
	className?: string;
	owner?: string;
	name?: string;
	branch?: string;
}

function isExternalLink(href: string): boolean {
	return /^(https?:\/\/|mailto:|data:|#)/.test(href);
}

function buildComponents(
	owner?: string,
	name?: string,
	branch?: string,
): Components {
	if (!owner || !name || !branch) return {};

	return {
		a: ({ href, children, ...props }) => {
			if (!href || isExternalLink(href)) {
				return (
					<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
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
			if (!src || isExternalLink(src)) {
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
}: MarkdownRendererProps) {
	const components = buildComponents(owner, name, branch);

	return (
		<div
			className={`prose prose-slate dark:prose-invert max-w-none ${className}`}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
				components={components}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
