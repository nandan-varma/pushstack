import { type RefObject, useEffect, useState } from "react";

interface Heading {
	id: string;
	text: string;
	level: number;
}

/**
 * "On this page" for a long README: its h1–h3 headings, read from the rendered
 * markdown (which loads lazily, so the list follows the DOM as it fills in).
 * Shown only when there are enough headings to be worth a jump list.
 */
export function ReadmeOutline({
	contentRef,
}: {
	contentRef: RefObject<HTMLElement | null>;
}) {
	const [headings, setHeadings] = useState<Heading[]>([]);

	useEffect(() => {
		const root = contentRef.current;
		if (!root) return;
		const read = () =>
			setHeadings(
				[...root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]")].map(
					(el) => ({
						id: el.id,
						text: el.textContent?.trim() ?? "",
						level: Number(el.tagName[1]),
					}),
				),
			);
		read();
		const observer = new MutationObserver(read);
		observer.observe(root, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [contentRef]);

	if (headings.length < 3) return null;
	const top = Math.min(...headings.map((h) => h.level));

	return (
		<nav
			aria-label="README contents"
			className="sticky top-6 hidden max-h-[calc(100vh-3rem)] overflow-y-auto 2xl:block"
		>
			<h2 className="mb-2 font-mono text-[10px] font-medium tracking-[0.12em] text-bjork-text-soft uppercase">
				On this page
			</h2>
			<ul className="space-y-0.5 border-l border-bjork-border-muted">
				{headings.map((heading) => (
					<li key={heading.id}>
						<a
							href={`#${heading.id}`}
							className="-ml-px block truncate border-l border-transparent py-1 pr-2 text-[13px] text-bjork-text-muted hover:border-bjork-text-soft hover:text-bjork-text"
							style={{
								paddingLeft: `${0.75 + (heading.level - top) * 0.75}rem`,
							}}
						>
							{heading.text}
						</a>
					</li>
				))}
			</ul>
		</nav>
	);
}
