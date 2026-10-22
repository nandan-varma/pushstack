import type * as React from "react";

import { cn } from "#/lib/utils.ts";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"flex field-sizing-content min-h-24 w-full rounded-[13px] border border-bjork-border bg-bjork-field-inset px-3.5 py-2.5 text-base leading-6 text-bjork-text shadow-(--bjork-shadow-inset) transition-[background-color,border-color,box-shadow] duration-200 outline-none placeholder:text-bjork-text-soft hover:border-bjork-border-strong focus-visible:border-bjork-border-strong focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
