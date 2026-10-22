import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "#/lib/utils.ts";
import { bjorkInputVariants } from "../bjork-ui/primitives/input";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				bjorkInputVariants({ variant: "inset" }),
				"text-base md:text-sm focus-visible:ring-ring aria-invalid:ring-destructive aria-invalid:border-destructive",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
