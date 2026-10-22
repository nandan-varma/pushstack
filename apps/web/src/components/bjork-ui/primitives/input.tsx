// Adapted from the Björk UI shadcn registry; native interaction primitives live in components/ui.
import { cva } from "class-variance-authority";

const bjorkInputVariants = cva(
	"flex w-full min-w-0 rounded-[13px] border-0 bg-[var(--bjork-field)] text-[color:var(--bjork-text)] outline-none backdrop-blur-md transition-[background-color,border-color,box-shadow,opacity,transform] duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[color:var(--bjork-text-soft)] selection:bg-[color:var(--bjork-accent)]/30 selection:text-[color:var(--bjork-text)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-[color:var(--bjork-border-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bjork-ring-offset)]",
	{
		variants: {
			variant: {
				default:
					"shadow-[var(--bjork-shadow-surface)] hover:bg-[var(--bjork-surface-hover)]",
				quiet:
					"bg-[var(--bjork-field-muted)] text-[color:var(--bjork-text-strong)] shadow-[var(--bjork-shadow-soft)] hover:bg-[var(--bjork-surface-hover)]",
				inset:
					"border border-[color:var(--bjork-border)] bg-[var(--bjork-field-inset)] shadow-[var(--bjork-shadow-inset)] hover:bg-[var(--bjork-panel)]",
				ghost: "bg-transparent shadow-none hover:bg-transparent",
				error:
					"border border-[color:var(--bjork-accent)]/42 bg-[var(--bjork-error-bg)] shadow-[inset_0_7px_14px_color-mix(in_srgb,var(--bjork-accent)_4%,transparent),0_8px_14px_-13px_color-mix(in_srgb,var(--bjork-accent)_28%,transparent)] focus-visible:ring-[color:var(--bjork-border-strong)]",
			},
			inputSize: {
				sm: "h-9 px-3 text-xs",
				md: "h-10 px-3.5 text-sm",
				lg: "h-12 px-4 text-[15px]",
			},
		},
		defaultVariants: {
			variant: "default",
			inputSize: "md",
		},
	},
);

export { bjorkInputVariants };
