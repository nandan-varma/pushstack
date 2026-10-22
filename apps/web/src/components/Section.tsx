import { Panel } from "@/components/layout/panel";

/** One settings group: a titled panel, tinted for destructive settings. */
export function Section({
	id,
	title,
	description,
	danger,
	children,
}: {
	id?: string;
	title: string;
	description?: string;
	danger?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Panel id={id} tone={danger ? "danger" : "surface"} className="p-5">
			<h2
				className={`text-[15px] font-semibold tracking-[-0.01em] ${danger ? "text-destructive" : "text-bjork-text"}`}
			>
				{title}
			</h2>
			{description && (
				<p className="mt-1 max-w-2xl text-sm leading-6 text-bjork-text-muted">
					{description}
				</p>
			)}
			<div className="mt-4">{children}</div>
		</Panel>
	);
}
