import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { LoadingButton } from "@/components/ui/loading-button";

export function NewThreadDialog({
	open,
	onOpenChange,
	triggerLabel,
	title,
	description,
	submitLabel,
	canSubmit,
	isPending,
	onSubmit,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	triggerLabel: string;
	title: string;
	description: string;
	submitLabel: string;
	canSubmit: boolean;
	isPending: boolean;
	onSubmit: () => void;
	children: ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm">{triggerLabel}</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">{children}</div>
				<DialogFooter>
					<Button
						variant="outline"
						disabled={isPending}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<LoadingButton
						onClick={onSubmit}
						disabled={!canSubmit}
						isLoading={isPending}
						loadingLabel="Creating…"
					>
						{submitLabel}
					</LoadingButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
