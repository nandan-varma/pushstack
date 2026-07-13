import { Badge } from "@/components/ui/badge";

export function VisibilityBadge({ visibility }: { visibility: string }) {
	return (
		<Badge
			variant={visibility === "public" ? "success" : "default"}
			className="text-[10px] px-1.5 py-0.5"
		>
			{visibility}
		</Badge>
	);
}
