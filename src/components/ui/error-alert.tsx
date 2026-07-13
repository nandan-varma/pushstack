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
				"rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400",
				className,
			)}
		>
			{message}
		</div>
	);
}
