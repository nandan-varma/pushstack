import { formatDistanceToNow, formatDistanceToNowStrict } from "date-fns";

/**
 * "5 minutes ago" as a <time> with the exact moment in its tooltip. Server
 * and browser render it at different instants, so a minute's drift between
 * them is expected rather than a hydration error.
 */
export function RelativeTime({
	date,
	strict = false,
	className,
}: {
	date: Date | string | number;
	/** "5 minutes" with no "about"/"ago", for dense columns. */
	strict?: boolean;
	className?: string;
}) {
	const value = new Date(date);
	return (
		<time
			dateTime={value.toISOString()}
			title={value.toLocaleString()}
			className={className}
			suppressHydrationWarning
		>
			{strict
				? formatDistanceToNowStrict(value)
				: formatDistanceToNow(value, { addSuffix: true })}
		</time>
	);
}
