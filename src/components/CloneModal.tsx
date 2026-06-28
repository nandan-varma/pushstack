/**
 * Clone Modal Component
 * Shows clone URL and instructions for cloning a repository
 */

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCloneUrl } from "@/lib/git-utils";

interface CloneModalProps {
	owner: string;
	repoName: string;
	trigger?: React.ReactNode;
}

export function CloneModal({ owner, repoName, trigger }: CloneModalProps) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const cloneUrlInputId = useId();
	const cloneCommandId = useId();

	const httpsUrl = getCloneUrl(owner, repoName, "https");

	const handleCopy = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy:", error);
		}
	};

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
							xmlns="http://www.w3.org/2000/svg"
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
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						Clone {owner}/{repoName}
					</DialogTitle>
					<DialogDescription>
						Clone this repository to your local machine
					</DialogDescription>
				</DialogHeader>

				<Tabs defaultValue="https" className="w-full">
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="https">HTTPS</TabsTrigger>
						<TabsTrigger value="ssh" disabled>
							SSH (Coming Soon)
						</TabsTrigger>
					</TabsList>

					<TabsContent value="https" className="space-y-4">
						<div className="space-y-2">
							<label
								className="text-sm font-medium text-[var(--sea-ink)]"
								htmlFor={cloneUrlInputId}
							>
								Clone URL
							</label>
							<div className="flex gap-2">
								<Input
									id={cloneUrlInputId}
									value={httpsUrl}
									readOnly
									className="font-mono text-sm"
								/>
								<Button
									onClick={() => handleCopy(httpsUrl)}
									variant="outline"
									size="sm"
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
						</div>

						<div className="space-y-2">
							<label
								className="text-sm font-medium text-[var(--sea-ink)]"
								htmlFor={cloneCommandId}
							>
								Clone with Git
							</label>
							<div
								id={cloneCommandId}
								className="rounded-lg bg-[var(--card-bg)] border border-[var(--line)] p-4"
							>
								<code className="text-sm text-[var(--sea-ink)]">
									git clone {httpsUrl}
								</code>
							</div>
						</div>

						<div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
							<div className="flex gap-2">
								<svg
									aria-hidden="true"
									className="h-5 w-5 text-amber-600 flex-shrink-0"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								</svg>
								<div className="text-sm text-amber-800">
									<p className="font-medium">
										Git HTTP protocol is now available
									</p>
									<p className="mt-1 text-amber-700">
										You can now use git clone, push, and pull commands.
										Authentication is required for private repositories.
									</p>
								</div>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="ssh">
						<div className="text-sm text-[var(--sea-ink-soft)]">
							SSH access coming soon...
						</div>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
