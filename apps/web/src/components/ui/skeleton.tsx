import { cn } from "#/lib/utils.ts";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn(
				"animate-pulse rounded-[10px] bg-bjork-surface-active",
				className,
			)}
			{...props}
		/>
	);
}

export { Skeleton };
