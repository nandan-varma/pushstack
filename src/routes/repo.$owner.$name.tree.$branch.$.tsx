import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	useNavigate,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getCloneUrl, getSetupInstructions } from "@/lib/git-utils";
import {
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryFileQueryOptions,
	repositoryFilesQueryOptions,
} from "@/lib/query-options";

function TreeErrorComponent({ error, reset }: ErrorComponentProps) {
	const isPathNotFound =
		error instanceof Error && error.name === "GitPathNotFoundError";
	return (
		<div className="island-shell rounded-xl p-12 text-center">
			<h2 className="mb-2 text-lg font-semibold text-[var(--sea-ink)]">
				{isPathNotFound ? "Path not found" : "Could not load files"}
			</h2>
			<p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
				{isPathNotFound
					? "The file or folder you're looking for does not exist in this repository."
					: error?.message || "An unexpected error occurred."}
			</p>
			<div className="flex items-center justify-center gap-2">
				<Button size="sm" onClick={reset}>
					Try again
				</Button>
			</div>
		</div>
	);
}

export const Route = createFileRoute("/repo/$owner/$name/tree/$branch/$")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await Promise.all([
				queryClient.ensureQueryData(repositoryBranchesQueryOptions(repo.id)),
				queryClient.ensureQueryData(
					repositoryFilesQueryOptions({
						repoId: repo.id,
						branchName: params.branch,
						path: params._splat || "",
					}),
				),
			]);
		}
	},
	errorComponent: TreeErrorComponent,
	component: TreeBrowserPage,
});

function FolderIcon() {
	return (
		<svg
			className="h-4 w-4 shrink-0 text-[var(--lagoon-deep)]"
			viewBox="0 0 16 16"
			fill="currentColor"
			aria-hidden="true"
		>
			<title>Folder</title>
			<path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
		</svg>
	);
}

function FileIcon() {
	return (
		<svg
			className="h-4 w-4 shrink-0 text-[var(--sea-ink-soft)]"
			viewBox="0 0 16 16"
			fill="currentColor"
			aria-hidden="true"
		>
			<title>File</title>
			<path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
		</svg>
	);
}

function CopyButton({ text }: { text: string }) {
	const { copied, copy } = useCopyToClipboard();
	return (
		<Button onClick={() => copy(text)} variant="outline" size="sm">
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}

function TreeBrowserPage() {
	const { owner, name, branch: activeBranch, _splat } = Route.useParams();
	const activePath = _splat || "";
	const navigate = useNavigate();

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	const { data: files, isLoading } = useQuery({
		...repositoryFilesQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: activeBranch,
			path: activePath,
		}),
		enabled: !!repo,
	});

	const sortedFiles = useMemo(() => {
		if (!files) return [];
		return [...files].sort((a, b) => {
			if (a.type === "tree" && b.type !== "tree") return -1;
			if (a.type !== "tree" && b.type === "tree") return 1;
			return a.path.localeCompare(b.path);
		});
	}, [files]);

	const readmeFile = useMemo(
		() => files?.find((f) => f.type === "blob" && /^readme\.md$/i.test(f.path)),
		[files],
	);

	const { data: readmeContent } = useQuery({
		...repositoryFileQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: activeBranch,
			path: readmeFile?.path ?? "",
		}),
		enabled: !!repo && !!readmeFile,
	});

	const handleBranchChange = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			navigate({
				to: "/repo/$owner/$name/tree/$branch/$",
				params: { owner, name, branch: e.target.value, _splat: activePath },
				replace: true,
			});
		},
		[navigate, owner, name, activePath],
	);

	if (!repo) return null;

	const isEmpty =
		!branches || branches.length === 0 || !files || files.length === 0;

	if (isEmpty && !isLoading) {
		const cloneUrl = getCloneUrl(owner, name, "https");
		const instructions = getSetupInstructions(owner, name, cloneUrl);

		return (
			<div className="space-y-4">
				{/* Clone URL */}
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

				{/* Setup options */}
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
						search={{ branch: activeBranch }}
					>
						<Button size="sm">Create new file</Button>
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex items-center justify-between gap-3">
				<select
					value={activeBranch}
					onChange={handleBranchChange}
					className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]/30"
				>
					{branches?.map((branch) => (
						<option key={branch.name} value={branch.name}>
							{branch.name}
							{branch.isDefault ? " (default)" : ""}
						</option>
					))}
				</select>

				<div className="flex items-center gap-2">
					<span className="text-xs text-[var(--sea-ink-soft)]">
						{files?.length || 0} files
					</span>
					<Link
						to="/repo/$owner/$name/upload"
						params={{ owner, name }}
						search={{ branch: activeBranch }}
					>
						<Button size="sm" variant="outline">
							+ Add file
						</Button>
					</Link>
				</div>
			</div>

			{/* Breadcrumb */}
			{activePath && (
				<div className="flex flex-wrap items-center gap-1.5 text-sm">
					<Link
						to="/repo/$owner/$name/tree/$branch/$"
						params={{ owner, name, branch: activeBranch, _splat: "" }}
						className="font-medium text-[var(--lagoon-deep)] hover:underline"
					>
						{name}
					</Link>
					{activePath.split("/").map((segment, i, segments) => {
						const pathSoFar = segments.slice(0, i + 1).join("/");
						const isLast = i === segments.length - 1;
						return (
							<span key={pathSoFar} className="flex items-center gap-1.5">
								<span className="text-[var(--sea-ink-soft)]">/</span>
								{isLast ? (
									<span className="font-medium text-[var(--sea-ink)]">
										{segment}
									</span>
								) : (
									<Link
										to="/repo/$owner/$name/tree/$branch/$"
										params={{
											owner,
											name,
											branch: activeBranch,
											_splat: pathSoFar,
										}}
										className="font-medium text-[var(--lagoon-deep)] hover:underline"
									>
										{segment}
									</Link>
								)}
							</span>
						);
					})}
				</div>
			)}

			{/* File browser */}
			{isLoading ? (
				<div className="overflow-hidden rounded-xl border border-[var(--line)]">
					{[1, 2, 3, 4, 5].map((i) => (
						<Skeleton
							key={i}
							className="h-11 rounded-none border-b border-[var(--line)] last:border-0"
						/>
					))}
				</div>
			) : files && files.length > 0 ? (
				<div className="overflow-hidden rounded-xl border border-[var(--line)]">
					<table className="w-full">
						<tbody>
							{activePath && (
								<tr className="border-b border-[var(--line)] transition hover:bg-[var(--surface-strong)]">
									<td className="w-8 py-2.5 pl-4" />
									<td className="py-2.5 pr-4">
										<Link
											to="/repo/$owner/$name/tree/$branch/$"
											params={{
												owner,
												name,
												branch: activeBranch,
												_splat: activePath.includes("/")
													? activePath.slice(0, activePath.lastIndexOf("/"))
													: "",
											}}
											className="text-sm font-medium text-[var(--lagoon-deep)] hover:underline"
										>
											..
										</Link>
									</td>
									<td />
								</tr>
							)}
							{sortedFiles.map((file) => {
								const displayName = activePath
									? file.path.slice(activePath.length + 1)
									: file.path;
								return (
									<tr
										key={`${file.type}:${file.path}`}
										className="border-b border-[var(--line)] transition hover:bg-[var(--surface-strong)] last:border-0"
									>
										<td className="w-8 py-2.5 pl-4">
											{file.type === "tree" ? <FolderIcon /> : <FileIcon />}
										</td>
										<td className="py-2.5 pr-4">
											{file.type === "tree" ? (
												<Link
													to="/repo/$owner/$name/tree/$branch/$"
													params={{
														owner,
														name,
														branch: activeBranch,
														_splat: file.path,
													}}
													title={displayName}
													className="max-w-xs truncate text-sm font-medium text-[var(--lagoon-deep)] hover:underline"
												>
													{displayName}
												</Link>
											) : (
												<Link
													to="/repo/$owner/$name/blob/$branch/$"
													params={{
														owner,
														name,
														branch: activeBranch,
														_splat: file.path,
													}}
													title={displayName}
													className="max-w-xs truncate text-sm font-medium text-[var(--lagoon-deep)] hover:underline"
												>
													{displayName}
												</Link>
											)}
										</td>
										<td className="py-2.5 pr-4 text-right">
											<code className="rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--sea-ink-soft)]">
												{file.oid.substring(0, 7)}
											</code>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			) : (
				<div className="island-shell rounded-xl p-12 text-center">
					<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
						This repository is empty.
					</p>
					<Link
						to="/repo/$owner/$name/upload"
						params={{ owner, name }}
						search={{ branch: activeBranch }}
					>
						<Button size="sm">Add file</Button>
					</Link>
				</div>
			)}

			{readmeContent && !readmeContent.isBinary && (
				<div className="overflow-hidden rounded-xl border border-[var(--line)]">
					<div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5">
						<FileIcon />
						<span className="text-sm font-medium text-[var(--sea-ink)]">
							{readmeFile?.path}
						</span>
					</div>
					<div className="p-6">
						<MarkdownRenderer
							content={readmeContent.content}
							owner={owner}
							name={name}
							branch={activeBranch}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
