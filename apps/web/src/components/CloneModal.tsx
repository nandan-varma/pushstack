import { Check, Copy } from "lucide-react";
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
	const [includeSubmodules, setIncludeSubmodules] = useState(false);
	const { copied, copy } = useCopyToClipboard();

	const httpsUrl = getCloneUrl(owner, repoName);
	const cloneCommand = `git clone ${includeSubmodules ? "--recurse-submodules " : ""}${httpsUrl}`;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{trigger || (
					<Button variant="outline">
						<Copy aria-hidden="true" className="mr-2 h-4 w-4" />
						Clone
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Clone repository</DialogTitle>
				</DialogHeader>

				<div className="space-y-2">
					<p className="text-sm text-muted-foreground">
						Run this command in your terminal:
					</p>
					<div className="flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-3">
						<code className="flex-1 text-sm text-foreground break-all">
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
								<Check aria-hidden="true" className="h-4 w-4 text-success" />
							) : (
								<Copy aria-hidden="true" className="h-4 w-4" />
							)}
						</Button>
					</div>
					<label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={includeSubmodules}
							onChange={(event) => setIncludeSubmodules(event.target.checked)}
							className="size-4 accent-primary"
						/>
						Include submodules (recursive)
					</label>
					<p className="text-xs text-muted-foreground">
						Private repositories and submodules require their own access.
					</p>
				</div>
			</DialogContent>
		</Dialog>
	);
}
