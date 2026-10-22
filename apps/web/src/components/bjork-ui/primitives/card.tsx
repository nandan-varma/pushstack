// Adapted from the Björk UI shadcn registry; native interaction primitives live in components/ui.
import { cva } from "class-variance-authority";

const bjorkCardVariants = cva(
	"relative flex flex-col overflow-hidden rounded-[20px] border text-[color:var(--bjork-text)] outline-none transition-[background-color,border-color,box-shadow,opacity,transform] duration-300 focus-visible:ring-2 focus-visible:ring-[color:var(--bjork-accent)]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bjork-ring-offset)]",
	{
		variants: {
			variant: {
				surface:
					"border-[color:var(--bjork-border-muted)] bg-[var(--bjork-surface)] shadow-[var(--bjork-shadow-surface)]",
				elevated:
					"border-[color:var(--bjork-border-muted)] bg-[var(--bjork-surface)] shadow-[var(--bjork-shadow-surface)]",
				quiet:
					"border-[color:var(--bjork-border-muted)] bg-[var(--bjork-panel)] shadow-[var(--bjork-shadow-soft)]",
				interactive:
					"cursor-pointer border-[color:var(--bjork-border-muted)] bg-[var(--bjork-surface)] shadow-[var(--bjork-shadow-surface)] hover:border-[color:var(--bjork-border)] hover:bg-[var(--bjork-surface-hover)]",
			},
			padding: {
				none: "p-0",
				sm: "p-3",
				md: "p-4",
				lg: "p-5",
			},
		},
		defaultVariants: {
			variant: "surface",
			padding: "md",
		},
	},
);

export { bjorkCardVariants };
