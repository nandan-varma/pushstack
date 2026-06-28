import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getCloneUrl } from "@/lib/git-utils";

interface CloneModalProps {
	owner: string;
	repoName: string;
	trigger?: React.ReactNode;
}

export function CloneModal({ owner, repoName, trigger }: CloneModalProps) {
	const [open, setOpen] = useState(false);
	const { copied, copy } = useCopyToClipboard();

	const httpsUrl = getCloneUrl(owner, repoName, "https");
	const cloneCommand = `git clone ${httpsUrl}`;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{trigger || (
					<Button variant="outline" size="sm">
						<svg
							aria-hidden="true"
							className="mr-2 h-4 w-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
							/>
						</svg>
						Clone
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Clone repository</DialogTitle>
				</DialogHeader>

				<div className="space-y-2">
					<p className="text-sm text-[var(--sea-ink-soft)]">
						Run this command in your terminal:
					</p>
					<div className="flex items-center gap-2 rounded-lg bg-[var(--card-bg)] border border-[var(--line)] px-4 py-3">
						<code className="flex-1 text-sm text-[var(--sea-ink)] break-all">
							{cloneCommand}
						</code>
						<Button
							onClick={() => copy(cloneCommand)}
							variant="ghost"
							size="sm"
							className="shrink-0"
							aria-label={copied ? "Copied" : "Copy command"}
						>
							{copied ? (
								<svg
									aria-hidden="true"
									className="h-4 w-4 text-green-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M5 13l4 4L19 7"
									/>
								</svg>
							) : (
								<svg
									aria-hidden="true"
									className="h-4 w-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
									/>
								</svg>
							)}
						</Button>
					</div>
					<p className="text-xs text-[var(--sea-ink-soft)]">
						Private repositories require authentication.
					</p>
				</div>
			</DialogContent>
		</Dialog>
	);
}
