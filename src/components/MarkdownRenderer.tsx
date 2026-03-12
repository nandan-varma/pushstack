import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
	content: string;
	className?: string;
}

export default function MarkdownRenderer({
	content,
	className = "",
}: MarkdownRendererProps) {
	return (
		<div
			className={`prose prose-slate dark:prose-invert max-w-none ${className}`}
			style={
				{
					// Custom prose styles to match GitHub
					"--tw-prose-body": "var(--sea-ink)",
					"--tw-prose-headings": "var(--sea-ink)",
					"--tw-prose-links": "var(--accent)",
					"--tw-prose-bold": "var(--sea-ink)",
					"--tw-prose-code": "var(--sea-ink)",
					"--tw-prose-pre-bg": "var(--card-bg)",
					"--tw-prose-pre-code": "var(--sea-ink)",
					"--tw-prose-quotes": "var(--sea-ink-soft)",
					"--tw-prose-quote-borders": "var(--line)",
					"--tw-prose-hr": "var(--line)",
					"--tw-prose-th-borders": "var(--line)",
					"--tw-prose-td-borders": "var(--line)",
				} as any
			}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
				components={{
					// Custom link rendering with external link handling
					a: ({ href, children, ...props }) => {
						const isExternal = href?.startsWith("http");
						return (
							<a
								href={href}
								target={isExternal ? "_blank" : undefined}
								rel={isExternal ? "noopener noreferrer" : undefined}
								className="text-[var(--accent)] hover:underline"
								{...props}
							>
								{children}
							</a>
						);
					},
					// Custom code block with syntax highlighting
					code: ({ inline, className, children, ...props }: any) => {
						return !inline ? (
							<code className={className} {...props}>
								{children}
							</code>
						) : (
							<code
								className="px-1.5 py-0.5 rounded bg-[var(--chip-bg)] text-[var(--sea-ink)] border border-[var(--chip-line)] text-sm"
								{...props}
							>
								{children}
							</code>
						);
					},
					// Custom table styling
					table: ({ children, ...props }) => (
						<div className="overflow-x-auto">
							<table
								className="min-w-full divide-y divide-[var(--line)] border border-[var(--line)] rounded-lg"
								{...props}
							>
								{children}
							</table>
						</div>
					),
					th: ({ children, ...props }) => (
						<th
							className="px-4 py-2 bg-[var(--card-bg)] text-left text-sm font-semibold text-[var(--sea-ink)] border-b border-[var(--line)]"
							{...props}
						>
							{children}
						</th>
					),
					td: ({ children, ...props }) => (
						<td
							className="px-4 py-2 text-sm text-[var(--sea-ink)] border-b border-[var(--line)]"
							{...props}
						>
							{children}
						</td>
					),
					// Custom blockquote
					blockquote: ({ children, ...props }) => (
						<blockquote
							className="border-l-4 border-[var(--line)] pl-4 py-2 my-4 bg-[var(--card-bg)] rounded-r"
							{...props}
						>
							{children}
						</blockquote>
					),
					// Task list items
					input: ({ type, checked, ...props }: any) => {
						if (type === "checkbox") {
							return (
								<input
									type="checkbox"
									checked={checked}
									disabled
									className="mr-2"
									{...props}
								/>
							);
						}
						return <input type={type} {...props} />;
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
