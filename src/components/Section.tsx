import { Card } from "@/components/ui/card";

export function Section({
	title,
	description,
	danger,
	children,
}: {
	title: string;
	description?: string;
	danger?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Card
			className={`p-6 ${danger ? "border-red-300 dark:border-red-800/50" : ""}`}
		>
			<h2
				className={`mb-1 text-base font-semibold ${danger ? "text-red-700 dark:text-red-400" : "text-[var(--sea-ink)]"}`}
			>
				{title}
			</h2>
			{description && (
				<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">{description}</p>
			)}
			{children}
		</Card>
	);
}
