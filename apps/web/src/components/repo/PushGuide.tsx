import { Link } from "@tanstack/react-router";
import { Check, Copy, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { CopyField } from "@/components/CopyField";
import { Panel } from "@/components/layout/panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getCloneUrl, getSetupInstructions } from "@/lib/git-utils";

function CommandWell({ code }: { code: string }) {
	const { copied, copy } = useCopyToClipboard();
	return (
		<div className="relative">
			<pre className="overflow-x-auto rounded-[12px] border border-bjork-border bg-bjork-field-inset px-4 py-3 pr-12 font-mono text-[12.5px] leading-6 text-bjork-text-strong shadow-(--bjork-shadow-inset)">
				<code>{code}</code>
			</pre>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={() => copy(code)}
				aria-label={copied ? "Copied" : "Copy commands"}
				className="absolute top-2 right-2 text-bjork-text-soft"
			>
				{copied ? <Check className="text-success" /> : <Copy />}
			</Button>
		</div>
	);
}

function Step({
	n,
	title,
	children,
}: {
	n: number;
	title: string;
	children: ReactNode;
}) {
	return (
		<li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 px-5 py-5">
			<span
				aria-hidden="true"
				className="flex size-7 items-center justify-center rounded-full border border-bjork-border bg-bjork-surface-active font-mono text-xs text-bjork-text-medium"
			>
				{n}
			</span>
			<div className="min-w-0 space-y-3">
				<h3 className="pt-1 text-sm font-semibold text-bjork-text">{title}</h3>
				{children}
			</div>
		</li>
	);
}

/**
 * Getting code into a repository, in order: a token (git over HTTPS takes
 * tokens, not passwords), the remote, and the commands for a new or
 * existing project — or a browser upload.
 */
export function PushGuide({
	owner,
	name,
	branch,
	canWrite,
}: {
	owner: string;
	name: string;
	branch: string;
	canWrite: boolean;
}) {
	const cloneUrl = getCloneUrl(owner, name);
	const instructions = getSetupInstructions(name, cloneUrl);
	return (
		<Panel>
			<ol className="divide-y divide-bjork-border-muted">
				<Step n={1} title="Create a personal access token">
					<p className="text-sm leading-6 text-bjork-text-muted">
						When git asks for a password, give it a token with{" "}
						<code>repo:write</code> — your account password won't work.
					</p>
					<Link
						to="/settings"
						hash="tokens"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						Create a token
					</Link>
				</Step>
				<Step n={2} title="Use this remote">
					<CopyField value={cloneUrl} label="Copy clone URL" />
				</Step>
				<Step n={3} title="Push your code">
					<Tabs defaultValue="existing" className="gap-3">
						<TabsList>
							<TabsTrigger value="existing">Existing project</TabsTrigger>
							<TabsTrigger value="new">New project</TabsTrigger>
						</TabsList>
						<TabsContent value="existing">
							<CommandWell code={instructions.existingRepo} />
						</TabsContent>
						<TabsContent value="new">
							<CommandWell code={instructions.newRepo} />
						</TabsContent>
					</Tabs>
					{canWrite && (
						<p className="flex flex-wrap items-center gap-2 text-sm text-bjork-text-muted">
							Or skip git for now:
							<Link
								to="/$owner/$name/upload/$branch/$"
								params={{ owner, name, branch, _splat: "" }}
								className="inline-flex items-center gap-1.5 font-medium text-bjork-accent hover:underline"
							>
								<Upload aria-hidden="true" className="size-3.5" />
								upload a file
							</Link>
						</p>
					)}
				</Step>
			</ol>
		</Panel>
	);
}
