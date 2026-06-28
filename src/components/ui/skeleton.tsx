interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
	className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
	return (
		<div
			className={`animate-pulse rounded-xl border border-[var(--line)] bg-[var(--surface)] ${className ?? ""}`}
			{...props}
		/>
	);
}
