import { useState } from "react";
import { LinkifiedText } from "@/components/LinkifiedText";
import type { ResolveReference } from "@/lib/reference-patterns";

// Long, mostly-auto-generated commit bodies (squash merges, changelog
// dumps) get collapsed by default so the page doesn't open at 10x scroll
// height; short/typical bodies always render in full, matching GitHub.
const BODY_LINE_COLLAPSE_THRESHOLD = 6;
const BODY_CHAR_COLLAPSE_THRESHOLD = 400;

export function CommitMessage({
	message,
	owner,
	name,
	resolveReference,
	subjectClassName = "text-2xl font-bold text-[var(--sea-ink)] leading-snug break-words",
	bodyClassName = "whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--sea-ink-soft)]",
}: {
	message: string;
	owner: string;
	name: string;
	resolveReference?: ResolveReference;
	subjectClassName?: string;
	bodyClassName?: string;
}) {
	const [expanded, setExpanded] = useState(false);

	const trimmed = message.trim();
	const newlineIndex = trimmed.indexOf("\n");
	const subject =
		newlineIndex === -1 ? trimmed : trimmed.slice(0, newlineIndex);
	const body =
		newlineIndex === -1 ? "" : trimmed.slice(newlineIndex + 1).trim();

	const isLongBody =
		body.length > BODY_CHAR_COLLAPSE_THRESHOLD ||
		body.split("\n").length > BODY_LINE_COLLAPSE_THRESHOLD;
	const isCollapsed = isLongBody && !expanded;

	return (
		<div>
			<h1 className={subjectClassName}>
				<LinkifiedText
					text={subject}
					owner={owner}
					name={name}
					resolveReference={resolveReference}
				/>
			</h1>
			{body && (
				<p
					className={`mt-2 ${bodyClassName} ${isCollapsed ? "line-clamp-6" : ""}`}
				>
					<LinkifiedText
						text={body}
						owner={owner}
						name={name}
						resolveReference={resolveReference}
					/>
				</p>
			)}
			{isLongBody && (
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					className="mt-1.5 text-xs font-medium text-[var(--lagoon-deep)] hover:underline"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</div>
	);
}
