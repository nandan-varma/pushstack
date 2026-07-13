import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
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
	const cloneUrl = getCloneUrl(owner, name, "https");
	const instructions = getSetupInstructions(owner, name, cloneUrl);

	return (
		<div className="space-y-4">
			<div className="island-shell rounded-xl p-5">
				<p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--kicker)]">
					HTTPS clone URL
				</p>
				<div className="mt-2 flex gap-2">
					<input
						type="text"
						value={cloneUrl}
						readOnly
						className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--sea-ink)]"
					/>
					<CopyButton text={cloneUrl} />
				</div>
			</div>

			{(
				[
					["Create a new repository", instructions.newRepo],
					["Push an existing repository", instructions.existingRepo],
				] as const
			).map(([heading, code]) => (
				<div key={heading} className="island-shell rounded-xl p-5">
					<p className="mb-3 text-sm font-semibold text-[var(--sea-ink)]">
						{heading}
					</p>
					<div className="flex items-start gap-3">
						<pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-[var(--line)] bg-[#1a2e3a] p-4 text-xs text-[#e8efff]">
							<code>{code}</code>
						</pre>
						<CopyButton text={code} />
					</div>
				</div>
			))}

			<div className="island-shell rounded-xl p-5">
				<p className="mb-1 text-sm font-semibold text-[var(--sea-ink)]">
					Create a file via the web interface
				</p>
				<p className="mb-3 text-xs text-[var(--sea-ink-soft)]">
					Upload or create files directly from your browser.
				</p>
				<Link
					to="/repo/$owner/$name/upload"
					params={{ owner, name }}
					search={{ branch }}
				>
					<Button size="sm">Create new file</Button>
				</Link>
			</div>
		</div>
	);
}
