import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function FormField({
	label,
	htmlFor,
	hint,
	children,
}: {
	label: ReactNode;
	htmlFor?: string;
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={htmlFor}>
				{label}
				{hint && (
					<span className="font-normal text-bjork-text-soft"> {hint}</span>
				)}
			</Label>
			{children}
		</div>
	);
}
