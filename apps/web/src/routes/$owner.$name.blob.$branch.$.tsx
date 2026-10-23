import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Check,
	Copy,
	Download,
	FileCode,
	Link2,
	UserRound,
} from "lucide-react";
import { lazy, Suspense } from "react";
import {
	FileCommitBanner,
	FileHistoryList,
} from "@/components/FileHistoryPanel";
import { Toolbar } from "@/components/layout/page";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import { FilePreview } from "@/components/repo/FilePreview";
import { RepoResourceNotFound } from "@/components/repo/RepoResourceNotFound";
import { SubmoduleCard } from "@/components/repo/SubmoduleCard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getPreviewMode } from "@/lib/file-preview";
import { rawFileUrl } from "@/lib/file-view";
import {
	countLines,
	detectLanguage,
	formatFileSize,
} from "@/lib/language-detection";
import {
	repositoryByNameQueryOptions,
	repositoryFileHistoryQueryOptions,
	repositoryFileQueryOptions,
} from "@/lib/query-options";

const CodeViewer = lazy(() => import("@/components/CodeViewer"));

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

function encodePath(path: string) {
	return path.split("/").map(encodeURIComponent).join("/");
}

export const Route = createFileRoute("/$owner/$name/blob/$branch/$")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(
				repositoryFileQueryOptions({
					repoId: repo.id,
					branchName: params.branch,
					path: params._splat || "",
				}),
			);
		}
	},
	component: FileBlobPage,
	notFoundComponent: () => (
		<RepoResourceNotFound
			title="File not found"
			message="This branch or file doesn't exist."
		/>
	),
});

function FileBlobPage() {
	const { owner, name, branch, _splat } = Route.useParams();
	const filePath = _splat || "";

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const {
		data: file,
		isLoading,
		error,
	} = useQuery({
		...repositoryFileQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: branch,
			path: filePath,
		}),
		enabled: !!repo,
	});

	// Shares its cache entry with FileCommitBanner's own fetch below (same
	// query key), so this doesn't cost a second request — just needed here
	// too so the permalink button can read the resolved commit sha.
	const { data: latestHistory } = useQuery({
		...repositoryFileHistoryQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: branch,
			path: filePath,
			limit: 1,
		}),
		enabled: !!repo,
	});
	const latestSha = latestHistory?.entries[0]?.sha;
	const isPinnedRevision = FULL_SHA_RE.test(branch);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-1/3" />
				<Skeleton className="h-96" />
			</div>
		);
	}

	if (error || !file) {
		return (
			<NotFoundCard
				title="File Not Found"
				message={`The file "${filePath}" does not exist in the ${branch} branch.`}
				backTo="/$owner/$name/tree/$branch/$"
				backParams={{ owner, name, branch, _splat: "" }}
				backLabel="Back to Files"
			/>
		);
	}

	if (file.kind === "submodule") {
		return (
			<div className="space-y-4">
				<PathBreadcrumb
					owner={owner}
					name={name}
					branch={branch}
					filePath={filePath}
					asHeading
				/>
				<SubmoduleCard
					oid={file.oid}
					url={file.url}
					owner={owner}
					name={name}
				/>
				<FileHistoryList
					owner={owner}
					name={name}
					repoId={repo?.id ?? 0}
					branch={branch}
					filePath={filePath}
				/>
			</div>
		);
	}

	const language = detectLanguage(filePath);
	const previewMode = getPreviewMode(filePath, file.kind);
	const fileName = filePath.split("/").pop() || filePath;
	// Bytes are fetched from the raw endpoint only when asked for (view raw,
	// download, media preview) — never shipped inside the page data.
	const rawUrl = rawFileUrl({ owner, name, ref: branch, path: filePath });

	const lineCount = file.kind === "text" ? countLines(file.content) : undefined;
	const permalink = latestSha
		? `${typeof window === "undefined" ? "" : window.location.origin}/${owner}/${name}/blob/${latestSha}/${encodePath(filePath)}`
		: undefined;

	return (
		<Tabs defaultValue={previewMode ? "preview" : "code"} className="gap-4">
			<Toolbar>
				<div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
					<PathBreadcrumb
						owner={owner}
						name={name}
						branch={branch}
						filePath={filePath}
						asHeading
					/>
					<p className="flex items-center gap-x-2 text-xs text-bjork-text-soft tabular-nums">
						{lineCount !== undefined && (
							<>
								<span>
									{lineCount} {lineCount === 1 ? "line" : "lines"}
								</span>
								<span aria-hidden="true">·</span>
							</>
						)}
						<span>{formatFileSize(file.size)}</span>
						<span aria-hidden="true">·</span>
						<span>{language}</span>
					</p>
				</div>
				<TabsList>
					{previewMode && <TabsTrigger value="preview">Preview</TabsTrigger>}
					<TabsTrigger value="code">Code</TabsTrigger>
					<TabsTrigger value="history">History</TabsTrigger>
				</TabsList>
			</Toolbar>

			{isPinnedRevision ? (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border border-bjork-border bg-bjork-panel px-4 py-2.5 text-[13px] text-bjork-text-muted">
					<span>
						Pinned to commit{" "}
						<code className="font-mono text-bjork-text">
							{branch.substring(0, 7)}
						</code>
						, not the latest on any branch.
					</span>
					{repo?.defaultBranch ? (
						<Link
							to="/$owner/$name/blob/$branch/$"
							params={{
								owner,
								name,
								branch: repo.defaultBranch,
								_splat: filePath,
							}}
							className="font-medium text-bjork-accent hover:underline"
						>
							View latest on {repo.defaultBranch}
						</Link>
					) : null}
				</div>
			) : null}

			{(["preview", "code"] as const).map((view) =>
				view === "preview" && !previewMode ? null : (
					<TabsContent key={view} value={view}>
						<Panel aria-label={fileName}>
							<PanelHeader
								actions={
									<FileActions
										rawUrl={rawUrl}
										fileName={fileName}
										content={file.kind === "text" ? file.content : undefined}
										permalink={permalink}
										blame={
											file.kind === "text"
												? { owner, name, branch, path: filePath }
												: undefined
										}
									/>
								}
							>
								{isPinnedRevision ? (
									<span className="font-mono text-xs text-bjork-text-soft">
										@ {branch.substring(0, 7)}
									</span>
								) : (
									<FileCommitBanner
										owner={owner}
										name={name}
										repoId={repo?.id ?? 0}
										branch={branch}
										filePath={filePath}
										bare
									/>
								)}
							</PanelHeader>
							{view === "preview" ? (
								<div
									className={
										previewMode === "media" ? "" : "p-5 sm:px-8 sm:py-7"
									}
								>
									<FilePreview
										file={file}
										filePath={filePath}
										owner={owner}
										name={name}
										branch={branch}
										repoId={repo?.id}
									/>
								</div>
							) : file.kind === "text" ? (
								<Suspense fallback={<Skeleton className="m-5 h-96" />}>
									<CodeViewer code={file.content} language={language} />
								</Suspense>
							) : (
								<div className="px-5 py-14 text-center">
									<p className="text-sm text-bjork-text-muted">
										{file.kind === "binary"
											? "This file is binary and can't be displayed."
											: `This file is too large to display (${formatFileSize(file.size)}).`}
									</p>
									<div className="mt-4 flex justify-center gap-2">
										<Button variant="outline" asChild>
											<a href={rawUrl} target="_blank" rel="noreferrer">
												View raw
											</a>
										</Button>
										<Button variant="outline" asChild>
											<a href={rawUrl} download={fileName}>
												Download
											</a>
										</Button>
									</div>
								</div>
							)}
						</Panel>
					</TabsContent>
				),
			)}

			<TabsContent value="history">
				<FileHistoryList
					owner={owner}
					name={name}
					repoId={repo?.id ?? 0}
					branch={branch}
					filePath={filePath}
				/>
			</TabsContent>
		</Tabs>
	);
}

/** Copy, raw, permalink and download as one quiet icon group. */
function FileActions({
	rawUrl,
	fileName,
	content,
	permalink,
	blame,
}: {
	rawUrl: string;
	fileName: string;
	content?: string;
	permalink?: string;
	/** Text files only: where the blame view of this file lives. */
	blame?: { owner: string; name: string; branch: string; path: string };
}) {
	const contentCopy = useCopyToClipboard();
	const linkCopy = useCopyToClipboard();
	const iconButton = buttonVariants({ variant: "ghost", size: "icon-sm" });
	return (
		<div className="flex items-center gap-0.5">
			{content !== undefined && (
				<button
					type="button"
					className={iconButton}
					onClick={() => contentCopy.copy(content)}
					aria-label={contentCopy.copied ? "Copied" : "Copy file contents"}
					title="Copy file contents"
				>
					{contentCopy.copied ? <Check className="text-success" /> : <Copy />}
				</button>
			)}
			{blame && (
				<Link
					to="/$owner/$name/blame/$branch/$"
					params={{
						owner: blame.owner,
						name: blame.name,
						branch: blame.branch,
						_splat: blame.path,
					}}
					className={iconButton}
					aria-label="Blame"
					title="Blame"
				>
					<UserRound />
				</Link>
			)}
			<button
				type="button"
				className={iconButton}
				disabled={!permalink}
				onClick={() => permalink && linkCopy.copy(permalink)}
				aria-label={linkCopy.copied ? "Permalink copied" : "Copy permalink"}
				title="Copy permalink"
			>
				{linkCopy.copied ? <Check className="text-success" /> : <Link2 />}
			</button>
			<a
				href={rawUrl}
				target="_blank"
				rel="noreferrer"
				className={iconButton}
				aria-label="View raw"
				title="View raw"
			>
				<FileCode />
			</a>
			<a
				href={rawUrl}
				download={fileName}
				className={iconButton}
				aria-label="Download"
				title="Download"
			>
				<Download />
			</a>
		</div>
	);
}
