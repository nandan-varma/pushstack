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
		<div className="space-y-1.5">
			<Label htmlFor={htmlFor}>
				{label}
				{hint && (
					<span className="font-normal text-[var(--sea-ink-soft)]">
						{" "}
						{hint}
					</span>
				)}
			</Label>
			{children}
		</div>
	);
}
