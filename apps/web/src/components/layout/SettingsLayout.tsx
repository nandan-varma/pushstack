import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface SettingsSection {
	id: string;
	label: string;
	content: ReactNode;
	/** Destructive sections are set apart at the end of the index. */
	danger?: boolean;
}

/**
 * Settings as one scrolling page with a sticky index beside it: every
 * setting is a scroll away, and the index shows (and jumps to) where you are.
 */
export function SettingsLayout({
	title,
	actions,
	sections,
}: {
	title: ReactNode;
	actions?: ReactNode;
	sections: SettingsSection[];
}) {
	const [current, setCurrent] = useState(sections[0]?.id);
	// Callers pass a fresh array each render; observe again only when the
	// set of sections actually changes.
	const ids = sections.map((section) => section.id).join(" ");

	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible[0]) setCurrent(visible[0].target.id);
			},
			// A section counts as current once it reaches the top third.
			{ rootMargin: "0px 0px -66% 0px" },
		);
		for (const id of ids.split(" ")) {
			const element = document.getElementById(id);
			if (element) observer.observe(element);
		}
		return () => observer.disconnect();
	}, [ids]);

	return (
		<div className="grid gap-6 lg:grid-cols-[200px_minmax(0,760px)] lg:items-start">
			<div className="lg:sticky lg:top-6">
				<h1 className="mb-3 text-[22px] font-semibold tracking-[-0.025em] text-bjork-text">
					{title}
				</h1>
				{actions && <div className="mb-4">{actions}</div>}
				<nav aria-label="Settings sections" className="hidden lg:block">
					<ul className="space-y-0.5">
						{sections.map(({ id, label, danger }) => (
							<li key={id} className={cn(danger && "mt-3")}>
								<a
									href={`#${id}`}
									aria-current={current === id ? "location" : undefined}
									className={cn(
										"flex h-8 items-center rounded-[9px] px-2.5 text-sm text-bjork-text-muted transition-[background-color,color] duration-150 hover:bg-bjork-surface-hover hover:text-bjork-text",
										"aria-[current=location]:bg-bjork-surface-active aria-[current=location]:font-medium aria-[current=location]:text-bjork-text",
										danger && "text-destructive hover:text-destructive",
									)}
								>
									{label}
								</a>
							</li>
						))}
					</ul>
				</nav>
			</div>
			<div className="min-w-0 space-y-4">
				{sections.map(({ id, content }) => (
					<div key={id} id={id} className="scroll-mt-6">
						{content}
					</div>
				))}
			</div>
		</div>
	);
}
