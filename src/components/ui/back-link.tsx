import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function BackLink({
	to,
	params,
	label = "Back",
}: {
	to: string;
	params?: Record<string, string>;
	label?: string;
}) {
	return (
		<Link to={to} params={params}>
			<Button variant="outline" size="sm">
				{label}
			</Button>
		</Link>
	);
}
