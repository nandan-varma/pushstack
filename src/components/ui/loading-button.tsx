import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function LoadingButton({
	isLoading,
	loadingLabel,
	children,
	...props
}: React.ComponentProps<typeof Button> &
	VariantProps<typeof buttonVariants> & {
		isLoading?: boolean;
		loadingLabel?: ReactNode;
	}) {
	return (
		<Button {...props} disabled={isLoading || props.disabled}>
			{isLoading ? (
				<>
					<Spinner size="sm" />
					{loadingLabel ?? "Saving…"}
				</>
			) : (
				children
			)}
		</Button>
	);
}
