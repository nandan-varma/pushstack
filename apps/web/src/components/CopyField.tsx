import { CheckIcon, CopyIcon } from "@animateicons/react/lucide";
import { useIconAnimation } from "@/components/animated-icon";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

/** A read-only value in an inset well with a one-tap copy button. */
export function CopyField({
	value,
	label,
	className,
}: {
	value: string;
	/** Accessible name of the copy button, e.g. "Copy clone URL". */
	label: string;
	className?: string;
}) {
	const { copied, copy } = useCopyToClipboard();
	const { ref, triggerProps } = useIconAnimation<HTMLButtonElement>();
	return (
		<div
			className={cn(
				"flex h-9 min-w-0 items-center rounded-[12px] border border-bjork-border bg-bjork-field-inset pl-3 shadow-(--bjork-shadow-inset)",
				className,
			)}
		>
			<input
				readOnly
				// The server builds URLs from its configured origin; a preview
				// deployment's browser origin can differ.
				suppressHydrationWarning
				value={value}
				aria-label={label.replace(/^Copy /, "")}
				onFocus={(event) => event.currentTarget.select()}
				className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs text-bjork-text-medium outline-none"
			/>
			<button
				type="button"
				onClick={() => copy(value)}
				aria-label={copied ? "Copied" : label}
				className="flex size-9 shrink-0 items-center justify-center rounded-[11px] text-bjork-text-soft transition-[background-color,color] duration-150 hover:bg-bjork-surface-hover hover:text-bjork-text"
				{...triggerProps}
			>
				{copied ? (
					<CheckIcon size={14} className="text-success" aria-hidden="true" />
				) : (
					<CopyIcon ref={ref} size={14} aria-hidden="true" />
				)}
			</button>
		</div>
	);
}
