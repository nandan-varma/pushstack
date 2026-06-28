import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { detectLanguage, formatFileSize } from "@/lib/language-detection";
import {
	repositoryByNameQueryOptions,
	repositoryFileQueryOptions,
} from "@/lib/query-options";

const CodeViewer = lazy(() => import("@/components/CodeViewer"));

function decodeBase64ToBytes(content: string) {
	const binary = window.atob(content);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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

	if (isLoading) {
		return (
			<div className="container py-8">
				<div className="animate-pulse space-y-4">
					<div className="h-8 bg-[var(--card-bg)] rounded w-1/3" />
					<div className="h-96 bg-[var(--card-bg)] rounded" />
				</div>
			</div>
		);
	}

	if (error || !file) {
		return (
			<div className="container py-8">
				<Card className="p-6">
					<h2 className="text-xl font-semibold mb-2">File Not Found</h2>
					<p className="text-[var(--sea-ink-soft)]">
						The file "{filePath}" does not exist in the {branch} branch.
					</p>
					<Link
						to="/repo/$owner/$name"
						params={{ owner, name }}
						className="mt-4 inline-block"
					>
						<Button variant="outline">Back to Files</Button>
					</Link>
				</Card>
			</div>
		);
	}

	const language = detectLanguage(filePath);
	const isBinary = file.isBinary;
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
		<div className="container py-8 space-y-4">
			{/* File Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<h1 className="text-2xl font-bold text-[var(--sea-ink)]">
						{filePath}
					</h1>
					<span className="text-sm text-[var(--sea-ink-soft)]">
						{formatFileSize(file.size || fileContent.length)}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<Link to="/repo/$owner/$name" params={{ owner, name }}>
						<Button variant="outline" size="sm">
							Back to Files
						</Button>
					</Link>
					<Button variant="outline" size="sm" onClick={downloadFile}>
						Download
					</Button>
				</div>
			</div>

			{/* Breadcrumbs */}
			<div className="flex items-center gap-2 text-sm text-[var(--sea-ink-soft)]">
				<Link
					to="/repo/$owner/$name"
					params={{ owner, name }}
					className="hover:text-[var(--accent)]"
				>
					{name}
				</Link>
				{filePath.split("/").map((part, i, arr) => {
					const pathSoFar = arr.slice(0, i + 1).join("/");
					const isLast = i === arr.length - 1;
					return (
						<span key={pathSoFar} className="flex items-center gap-2">
							<span>/</span>
							{isLast ? (
								<span className="text-[var(--sea-ink)] font-medium">
									{part}
								</span>
							) : (
								<span className="hover:text-[var(--accent)]">{part}</span>
							)}
						</span>
					);
				})}
			</div>

			{/* File Content */}
			{isBinary ? (
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
				<Suspense
					fallback={
						<div className="h-96 animate-pulse rounded-lg border border-[var(--line)] bg-[var(--card-bg)]" />
					}
				>
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
		</div>
	);
}
