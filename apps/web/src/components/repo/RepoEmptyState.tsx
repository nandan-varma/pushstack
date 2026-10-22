import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getCloneUrl, getSetupInstructions } from "@/lib/git-utils";

function CopyButton({ text }: { text: string }) {
	const { copied, copy } = useCopyToClipboard();
	return (
		<Button onClick={() => copy(text)} variant="outline" size="sm">
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}

export function RepoEmptyState({
	owner,
	name,
	branch,
}: {
	owner: string;
	name: string;
	branch: string;
}) {
	const cloneUrl = getCloneUrl(owner, name);
	const instructions = getSetupInstructions(name, cloneUrl);

	return (
		<div className="space-y-4">
			<div className="island-shell rounded-[20px] p-5">
				<p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					HTTPS clone URL
				</p>
				<div className="mt-2 flex gap-2">
					<Input
						aria-label="HTTPS clone URL"
						type="text"
						value={cloneUrl}
						readOnly
						className="min-w-0 flex-1 font-mono text-xs"
					/>
					<CopyButton text={cloneUrl} />
				</div>
				<p className="mt-3 text-xs text-muted-foreground">
					When git asks for a password, use a{" "}
					<Link to="/settings" hash="tokens" className="underline">
						personal access token
					</Link>{" "}
					with <code className="font-mono">repo:write</code> — your account
					password won't work.
				</p>
			</div>

			{(
				[
					["Create a new repository", instructions.newRepo],
					["Push an existing repository", instructions.existingRepo],
				] as const
			).map(([heading, code]) => (
				<div key={heading} className="island-shell rounded-[20px] p-5">
					<p className="mb-3 text-sm font-semibold text-foreground">
						{heading}
					</p>
					<div className="flex items-start gap-3">
						<pre className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-muted p-4 text-xs leading-relaxed shadow-[var(--bjork-shadow-inset)] text-foreground">
							<code>{code}</code>
						</pre>
						<CopyButton text={code} />
					</div>
				</div>
			))}

			<div className="island-shell rounded-[20px] p-5">
				<p className="mb-1 text-sm font-semibold text-foreground">
					Create a file via the web interface
				</p>
				<p className="mb-3 text-xs text-muted-foreground">
					Upload or create files directly from your browser.
				</p>
				<Link
					to="/$owner/$name/upload"
					params={{ owner, name }}
					search={{ branch }}
				>
					<Button size="sm">Create new file</Button>
				</Link>
			</div>
		</div>
	);
}
