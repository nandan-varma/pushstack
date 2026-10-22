import { cn } from "#/lib/utils";

export function ErrorAlert({
	message,
	className,
}: {
	message: string;
	className?: string;
}) {
	if (!message) return null;
	return (
		<div
			className={cn(
				"rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive",
				className,
			)}
		>
			{message}
		</div>
	);
}
