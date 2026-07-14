import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, GitCommitHorizontal } from "lucide-react";
import { lazy, Suspense } from "react";
import { BinaryPreview } from "@/components/BinaryPreview";
import {
	FileCommitBanner,
	FileHistoryList,
} from "@/components/FileHistoryPanel";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import {
	detectLanguage,
	formatFileSize,
	getMimeType,
	getPreviewKind,
} from "@/lib/language-detection";
import {
	repositoryByNameQueryOptions,
	repositoryFileHistoryQueryOptions,
	repositoryFileQueryOptions,
} from "@/lib/query-options";

const CodeViewer = lazy(() => import("@/components/CodeViewer"));

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

function decodeBase64ToBytes(content: string) {
	const binary = window.atob(content);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodePath(path: string) {
	return path.split("/").map(encodeURIComponent).join("/");
}

export const Route = createFileRoute("/repo/$owner/$name/blob/$branch/$")({
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
				backTo="/repo/$owner/$name/tree/$branch/$"
				backParams={{ owner, name, branch, _splat: "" }}
				backLabel="Back to Files"
			/>
		);
	}

	const language = detectLanguage(filePath);
	const isBinary = file.isBinary;
	const previewKind = isBinary ? getPreviewKind(filePath) : null;
	const fileContent = !file.content
		? ""
		: file.isBinary
			? window.atob(file.content)
			: file.content;

	const downloadFile = () => {
		const blob = isBinary
			? new Blob([decodeBase64ToBytes(file.content)], {
					type: "application/octet-stream",
				})
			: new Blob([fileContent], { type: "text/plain;charset=utf-8" });
		const objectUrl = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = objectUrl;
		link.download = filePath.split("/").pop() || "download";
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(objectUrl);
	};

	return (
		<div className="space-y-4">
			{/* File Header */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<h1
						title={filePath}
						className="min-w-0 truncate text-xl font-bold text-[var(--sea-ink)] sm:text-2xl"
					>
						{filePath}
					</h1>
					<span className="shrink-0 text-sm text-[var(--sea-ink-soft)]">
						{formatFileSize(file.size || fileContent.length)}
					</span>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<BackLink
						to="/repo/$owner/$name/tree/$branch/$"
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
						<a
							href={`/api/raw/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${encodeURIComponent(branch)}/${encodePath(filePath)}`}
							target="_blank"
							rel="noreferrer"
						>
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
								`${window.location.origin}/repo/${owner}/${name}/blob/${latestSha}/${encodePath(filePath)}`,
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
					<Button variant="outline" size="sm" onClick={downloadFile}>
						Download
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
				<div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3.5 py-2 text-xs text-[var(--sea-ink-soft)]">
					<GitCommitHorizontal className="size-3.5 shrink-0" />
					<span>
						Viewing this file pinned to commit{" "}
						<code className="font-mono text-[var(--sea-ink)]">
							{branch.substring(0, 7)}
						</code>
						, not the latest on any branch.
					</span>
					{repo?.defaultBranch ? (
						<Link
							to="/repo/$owner/$name/blob/$branch/$"
							params={{
								owner,
								name,
								branch: repo.defaultBranch,
								_splat: filePath,
							}}
							className="font-medium text-[var(--lagoon-deep)] hover:underline"
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

			<Tabs defaultValue="code">
				<TabsList>
					<TabsTrigger value="code">Code</TabsTrigger>
					<TabsTrigger value="history">History</TabsTrigger>
				</TabsList>

				<TabsContent value="code" className="space-y-4">
					{/* File Content */}
					{isBinary && previewKind ? (
						<Card className="overflow-hidden p-0">
							<BinaryPreview
								data={file.content}
								mimeType={getMimeType(filePath)}
								previewKind={previewKind}
								fileName={filePath}
							/>
						</Card>
					) : isBinary ? (
						<Card className="p-8 text-center">
							<p className="text-[var(--sea-ink-soft)]">
								This file is binary and cannot be displayed.
							</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-4"
								onClick={downloadFile}
							>
								Download File
							</Button>
						</Card>
					) : (
						<Suspense fallback={<Skeleton className="h-96" />}>
							<CodeViewer
								code={fileContent}
								language={language}
								fileName={filePath.split("/").pop()}
							/>
						</Suspense>
					)}

					{/* File Info */}
					<Card className="p-4">
						<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
							<div>
								<p className="text-[var(--sea-ink-soft)]">Branch</p>
								<p className="font-medium text-[var(--sea-ink)]">{branch}</p>
							</div>
							<div>
								<p className="text-[var(--sea-ink-soft)]">Language</p>
								<p className="font-medium text-[var(--sea-ink)]">{language}</p>
							</div>
							<div>
								<p className="text-[var(--sea-ink-soft)]">Size</p>
								<p className="font-medium text-[var(--sea-ink)]">
									{formatFileSize(file.size || fileContent.length)}
								</p>
							</div>
							<div>
								<p className="text-[var(--sea-ink-soft)]">Lines</p>
								<p className="font-medium text-[var(--sea-ink)]">
									{fileContent.split("\n").length}
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
