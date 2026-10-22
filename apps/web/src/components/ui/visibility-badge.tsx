import { Badge } from "@/components/ui/badge";

export function VisibilityBadge({ visibility }: { visibility: string }) {
	return (
		<Badge
			variant="outline"
			className="h-5 rounded-full px-2 text-[11px] font-medium capitalize text-bjork-text-muted"
		>
			{visibility}
		</Badge>
	);
}
