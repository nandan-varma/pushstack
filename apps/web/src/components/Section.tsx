import { Card } from "@/components/ui/card";

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
		<Card
			id={id}
			className={`rounded-[20px] p-4 sm:p-6 ${danger ? "border-destructive/30" : ""}`}
		>
			<h2
				className={`mb-2 text-base font-semibold tracking-tight ${danger ? "text-destructive" : "text-foreground"}`}
			>
				{title}
			</h2>
			{description && (
				<p className="mb-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
					{description}
				</p>
			)}
			{children}
		</Card>
	);
}
