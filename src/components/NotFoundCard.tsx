import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function NotFoundCard({
	title,
	message,
	backTo,
	backParams,
	backLabel,
}: {
	title: string;
	message?: string;
	backTo: string;
	backParams?: Record<string, string>;
	backLabel: string;
}) {
	return (
		<Card className="p-6">
			<h2 className="text-xl font-semibold mb-2">{title}</h2>
			{message && <p className="text-[var(--sea-ink-soft)] mb-4">{message}</p>}
			<Link to={backTo} params={backParams} className="mt-4 inline-block">
				<Button variant="outline">{backLabel}</Button>
			</Link>
		</Card>
	);
}
