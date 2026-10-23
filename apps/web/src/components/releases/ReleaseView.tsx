import { Link } from "@tanstack/react-router";
import { DownloadIcon, FileArchiveIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { RelativeTime } from "@/components/RelativeTime";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFileSize } from "@/lib/language-detection";
import type { getReleases } from "@/server/releases";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

export type ReleaseItem = Awaited<
	ReturnType<typeof getReleases>
>["releases"][number];

const encodePath = (path: string) =>
	path.split("/").map(encodeURIComponent).join("/");

/** One release: heading with its badges, notes, and downloads. */
export function ReleaseEntry({
	owner,
	name,
	repoId,
	release,
	isLatest,
	heading = "link",
}: {
	owner: string;
	name: string;
	repoId: number;
	release: ReleaseItem;
	isLatest: boolean;
	/** `link` makes the title a link to the release page (list view). */
	heading?: "link" | "plain";
}) {
	const title = release.name?.trim() || release.tagName;
	const tagUrl = `/${owner}/${name}/releases/tag/${encodePath(release.tagName)}`;
	const downloadBase = `/${owner}/${name}/releases/download/${encodePath(release.tagName)}`;
	const when = release.publishedAt ?? release.createdAt;
	return (
		<article className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8">
			<div className="space-y-1.5 text-sm text-bjork-text-muted sm:pt-1">
				<p className="text-bjork-text">
					<RelativeTime date={when} />
				</p>
				<p>
					<Link
						to="/$owner"
						params={{ owner: release.author.username }}
						className="hover:text-bjork-text hover:underline"
					>
						{release.author.username}
					</Link>
				</p>
				<p className="font-mono text-xs break-all text-bjork-text-soft">
					{release.tagName}
				</p>
			</div>
			<div className="min-w-0 space-y-4">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="text-xl font-semibold tracking-[-0.02em] text-bjork-text">
						{heading === "link" ? (
							<a href={tagUrl} className="hover:text-bjork-accent">
								{title}
							</a>
						) : (
							title
						)}
					</h2>
					{isLatest && <Badge variant="success">Latest</Badge>}
					{release.prerelease && <Badge variant="info">Pre-release</Badge>}
					{release.draft && <Badge variant="outline">Draft</Badge>}
				</div>
				{release.body ? (
					<Suspense fallback={<Skeleton className="h-16" />}>
						<MarkdownRenderer
							content={release.body}
							owner={owner}
							name={name}
							repoId={repoId}
						/>
					</Suspense>
				) : null}
				<div className="overflow-hidden rounded-[14px] border border-bjork-border-muted">
					<p className="border-b border-bjork-border-muted bg-bjork-surface-muted px-4 py-2 text-xs font-medium text-bjork-text-muted">
						Assets{" "}
						<span className="font-mono tabular-nums">
							{release.assets.length + 2}
						</span>
					</p>
					<ul className="divide-y divide-bjork-border-muted text-sm">
						{release.assets.map((asset) => (
							<li
								key={asset.id}
								className="flex items-center gap-3 px-4 py-2.5"
							>
								<DownloadIcon className="size-4 shrink-0 text-bjork-text-soft" />
								<a
									href={`${downloadBase}/${encodeURIComponent(asset.name)}`}
									className="min-w-0 flex-1 truncate font-medium text-bjork-text hover:text-bjork-accent hover:underline"
									title={asset.label ?? asset.name}
								>
									{asset.name}
								</a>
								<span className="shrink-0 font-mono text-xs text-bjork-text-soft tabular-nums">
									{formatFileSize(asset.size)}
								</span>
								<span
									className="hidden w-24 shrink-0 text-right font-mono text-xs text-bjork-text-soft tabular-nums sm:block"
									title="Downloads"
								>
									{asset.downloadCount} downloads
								</span>
							</li>
						))}
						{[
							["Source code (zip)", "zip"],
							["Source code (tar.gz)", "tar.gz"],
						].map(([label, format]) => (
							<li key={format} className="flex items-center gap-3 px-4 py-2.5">
								<FileArchiveIcon className="size-4 shrink-0 text-bjork-text-soft" />
								<a
									href={`/${owner}/${name}/archive/refs/tags/${encodePath(release.tagName)}.${format}`}
									className="min-w-0 flex-1 truncate font-medium text-bjork-text hover:text-bjork-accent hover:underline"
								>
									{label}
								</a>
							</li>
						))}
					</ul>
				</div>
			</div>
		</article>
	);
}
