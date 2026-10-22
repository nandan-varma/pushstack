import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The repository star control: one bordered shell owned by the wrapper, with
 * an interactive segment and a read-only count segment. The shell (not the
 * Button) carries the surface, border and shadow so variant utilities can't
 * fight the starred state — the previous implementation overrode `bg-*` on an
 * outline Button and lost to CSS order, so the starred state rendered as a
 * plain ghost button in dark mode.
 */
export function StarButton({
	starCount,
	isStarred,
	isPending,
	signedIn,
	onToggle,
}: {
	starCount: number;
	isStarred: boolean;
	isPending: boolean;
	signedIn: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="inline-flex h-10 items-stretch overflow-hidden rounded-[13px] border border-border bg-card text-sm shadow-[var(--bjork-shadow-soft)] transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				aria-pressed={isStarred}
				aria-label={isStarred ? "Unstar repository" : "Star repository"}
				title={signedIn ? undefined : "Sign in to star this repository"}
				disabled={isPending}
				onClick={onToggle}
				className="h-full gap-2 rounded-none border-0 px-3 text-foreground hover:bg-muted focus-visible:ring-0"
			>
				<Star
					aria-hidden="true"
					className={cn(
						"size-4 transition-colors",
						isStarred ? "fill-primary text-primary" : "text-muted-foreground",
					)}
				/>
				<span>{isStarred ? "Starred" : "Star"}</span>
			</Button>
			<span
				aria-hidden="true"
				className="flex items-center border-l border-border bg-muted/50 px-3 text-[0.8rem] font-medium tabular-nums text-muted-foreground"
			>
				{starCount}
			</span>
			<span className="sr-only">
				{starCount} {starCount === 1 ? "star" : "stars"}
			</span>
		</div>
	);
}
