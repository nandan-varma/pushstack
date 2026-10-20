import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, GitCommitHorizontal } from "lucide-react";
import { lazy, Suspense } from "react";
import {
	FileCommitBanner,
	FileHistoryList,
} from "@/components/FileHistoryPanel";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import { FilePreview } from "@/components/repo/FilePreview";
import { RepoResourceNotFound } from "@/components/repo/RepoResourceNotFound";
import { SubmoduleCard } from "@/components/repo/SubmoduleCard";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getPreviewMode } from "@/lib/file-preview";
import { rawFileUrl } from "@/lib/file-view";
import { detectLanguage, formatFileSize } from "@/lib/language-detection";
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
	const { copied, copy } = useCopyToClipboard();

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
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="break-all text-xl font-bold sm:text-2xl">
						{filePath}
					</h1>
					<BackLink
						to="/$owner/$name/tree/$branch/$"
						params={{
							owner,
							name,
							branch,
							_splat: filePath.includes("/")
								? filePath.slice(0, filePath.lastIndexOf("/"))
								: "",
						}}
						label="Back to Files"
					/>
				</div>
				<PathBreadcrumb
					owner={owner}
					name={name}
					branch={branch}
					filePath={filePath}
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

	return (
		<div className="space-y-4">
			{/* File Header */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<h1
						title={filePath}
						className="min-w-0 truncate text-xl font-bold text-foreground sm:text-2xl"
					>
						{filePath}
					</h1>
					<span className="shrink-0 text-sm text-muted-foreground">
						{formatFileSize(file.size)}
					</span>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<BackLink
						to="/$owner/$name/tree/$branch/$"
						params={{
							owner,
							name,
							branch,
							_splat: filePath.includes("/")
								? filePath.slice(0, filePath.lastIndexOf("/"))
								: "",
						}}
						label="Back to Files"
					/>
					<Button variant="outline" size="sm" asChild>
						<a href={rawUrl} target="_blank" rel="noreferrer">
							<ExternalLink className="size-4" /> Raw
						</a>
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={!latestSha}
						onClick={() => {
							if (!latestSha) return;
							copy(
								`${window.location.origin}/${owner}/${name}/blob/${latestSha}/${encodePath(filePath)}`,
							);
						}}
					>
						{copied ? (
							<>
								<Check className="size-4" /> Copied
							</>
						) : (
							<>
								<Copy className="size-4" /> Permalink
							</>
						)}
					</Button>
					<Button variant="outline" size="sm" asChild>
						<a href={rawUrl} download={fileName}>
							Download
						</a>
					</Button>
				</div>
			</div>

			<PathBreadcrumb
				owner={owner}
				name={name}
				branch={branch}
				filePath={filePath}
			/>

			{isPinnedRevision ? (
				<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3.5 py-2 text-xs text-muted-foreground">
					<GitCommitHorizontal className="size-3.5 shrink-0" />
					<span>
						Viewing this file pinned to commit{" "}
						<code className="font-mono text-foreground">
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
							className="font-medium text-primary hover:underline"
						>
							View latest on {repo.defaultBranch}
						</Link>
					) : null}
				</div>
			) : (
				<FileCommitBanner
					owner={owner}
					name={name}
					repoId={repo?.id ?? 0}
					branch={branch}
					filePath={filePath}
				/>
			)}

			<Tabs defaultValue={previewMode ? "preview" : "code"}>
				<TabsList>
					{previewMode && <TabsTrigger value="preview">Preview</TabsTrigger>}
					<TabsTrigger value="code">Code</TabsTrigger>
					<TabsTrigger value="history">History</TabsTrigger>
				</TabsList>

				{previewMode && (
					<TabsContent value="preview">
						<Card
							className={
								previewMode === "media" ? "overflow-hidden p-0" : "p-6"
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
						</Card>
					</TabsContent>
				)}

				<TabsContent value="code" className="space-y-4">
					{/* File Content */}
					{file.kind === "text" ? (
						<Suspense fallback={<Skeleton className="h-96" />}>
							<CodeViewer
								code={file.content}
								language={language}
								fileName={fileName}
							/>
						</Suspense>
					) : (
						<Card className="p-8 text-center">
							<p className="text-muted-foreground">
								{file.kind === "binary"
									? "This file is binary and can't be displayed."
									: `This file is too large to display (${formatFileSize(file.size)}).`}
							</p>
							<div className="mt-4 flex justify-center gap-2">
								<Button variant="outline" size="sm" asChild>
									<a href={rawUrl} target="_blank" rel="noreferrer">
										View raw
									</a>
								</Button>
								<Button variant="outline" size="sm" asChild>
									<a href={rawUrl} download={fileName}>
										Download
									</a>
								</Button>
							</div>
						</Card>
					)}

					{/* File Info */}
					<Card className="p-4">
						<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
							<div>
								<p className="text-muted-foreground">Branch</p>
								<p className="font-medium text-foreground">{branch}</p>
							</div>
							<div>
								<p className="text-muted-foreground">Language</p>
								<p className="font-medium text-foreground">{language}</p>
							</div>
							<div>
								<p className="text-muted-foreground">Size</p>
								<p className="font-medium text-foreground">
									{formatFileSize(file.size)}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground">Lines</p>
								<p className="font-medium text-foreground">
									{file.kind === "text" ? file.content.split("\n").length : "—"}
								</p>
							</div>
						</div>
					</Card>
				</TabsContent>

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
		</div>
	);
}
