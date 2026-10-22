import { StarIcon } from "@animateicons/react/lucide";
import { useIconAnimation } from "@/components/animated-icon";
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
	const { ref, triggerProps } = useIconAnimation<HTMLButtonElement>();
	return (
		<div className="inline-flex h-10 items-stretch overflow-hidden rounded-[13px] border border-bjork-border bg-bjork-surface text-sm shadow-[var(--bjork-shadow-soft)] transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				aria-pressed={isStarred}
				aria-label={isStarred ? "Unstar repository" : "Star repository"}
				title={signedIn ? undefined : "Sign in to star this repository"}
				disabled={isPending}
				onClick={() => {
					// Starring is the moment worth marking; unstarring stays quiet.
					if (!isStarred) ref.current?.startAnimation();
					onToggle();
				}}
				{...triggerProps}
				className="h-full gap-2 rounded-none border-0 px-3 text-bjork-text hover:bg-bjork-surface-hover focus-visible:ring-0"
			>
				<StarIcon
					ref={ref}
					size={16}
					aria-hidden="true"
					className={cn(
						"transition-colors",
						isStarred
							? "text-warning [&_svg]:fill-current"
							: "text-bjork-text-soft",
					)}
				/>
				<span>{isStarred ? "Starred" : "Star"}</span>
			</Button>
			<span
				aria-hidden="true"
				className="flex items-center border-l border-bjork-border bg-bjork-panel px-3 text-[13px] font-medium tabular-nums text-bjork-text-medium"
			>
				{starCount}
			</span>
			<span className="sr-only">
				{starCount} {starCount === 1 ? "star" : "stars"}
			</span>
		</div>
	);
}
