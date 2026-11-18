import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_WIKI_PAGE_CHARS } from "@/lib/limits";
import { queryKeys } from "@/lib/query-options";
import { pageSlugFromTitle } from "@/lib/wiki-slug";
import { deleteWikiPage, saveWikiPage } from "@/server/wiki";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

/**
 * One page's editor: a markdown textarea, a lazy preview, and a delete action
 * for an existing page. Every save is one commit on the wiki's `master`.
 */
export function WikiEditor({
	owner,
	name,
	repoId,
	page,
	initialContent,
}: {
	owner: string;
	name: string;
	repoId: number;
	/** The page being edited; null when creating one. */
	page: string | null;
	initialContent: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [pageName, setPageName] = useState(page ?? "");
	const [content, setContent] = useState(initialContent);
	const [previewing, setPreviewing] = useState(false);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.repoWiki(repoId) });

	const save = useMutation({
		mutationFn: () =>
			saveWikiPage({
				data: { repoId, page: pageName.trim(), content },
			}),
		onSuccess: async (saved) => {
			await invalidate();
			await navigate({
				to: "/$owner/$name/wiki/$page",
				params: { owner, name, page: saved.page },
			});
		},
		onError: (error: Error) => toast(error.message, "error"),
	});

	const remove = useMutation({
		mutationFn: () =>
			deleteWikiPage({ data: { repoId, page: page ?? pageName } }),
		onSuccess: async () => {
			await invalidate();
			await navigate({ to: "/$owner/$name/wiki", params: { owner, name } });
		},
		onError: (error: Error) => toast(error.message, "error"),
	});

	const slug = pageSlugFromTitle(pageName);
	const tooLong = content.length > MAX_WIKI_PAGE_CHARS;
	const ready = slug !== "" && !tooLong && !save.isPending;

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="wiki-page-name">Page name</Label>
				<Input
					id="wiki-page-name"
					value={pageName}
					onChange={(event) => setPageName(event.target.value)}
					disabled={page !== null}
					placeholder="Getting Started"
				/>
			</div>
			<div className="flex items-center justify-between">
				<div className="flex gap-2">
					<Button
						type="button"
						variant={previewing ? "outline" : "default"}
						size="sm"
						onClick={() => setPreviewing(false)}
					>
						Write
					</Button>
					<Button
						type="button"
						variant={previewing ? "default" : "outline"}
						size="sm"
						onClick={() => setPreviewing(true)}
					>
						Preview
					</Button>
				</div>
				<span className="text-xs text-bjork-text-soft tabular-nums">
					{content.length} / {MAX_WIKI_PAGE_CHARS}
				</span>
			</div>
			{previewing ? (
				<div className="min-h-48 rounded-[13px] border border-bjork-border bg-bjork-surface p-4">
					<Suspense fallback={null}>
						<MarkdownRenderer
							content={content}
							repoId={repoId}
							filePath={slug ? `${slug}.md` : ""}
							linkBase={`/${owner}/${name}/wiki`}
						/>
					</Suspense>
				</div>
			) : (
				<Textarea
					value={content}
					onChange={(event) => setContent(event.target.value)}
					className="min-h-64 font-mono"
					aria-label="Page content"
				/>
			)}
			<div className="flex flex-wrap items-center gap-3">
				<LoadingButton
					onClick={() => save.mutate()}
					disabled={!ready}
					isLoading={save.isPending}
				>
					Save page
				</LoadingButton>
				{page !== null && (
					<Button
						type="button"
						variant="outline"
						disabled={remove.isPending}
						onClick={() => {
							if (window.confirm(`Delete ${page}?`)) remove.mutate();
						}}
					>
						Delete page
					</Button>
				)}
				{tooLong && (
					<p className="text-sm text-destructive">
						This page is longer than {MAX_WIKI_PAGE_CHARS} characters.
					</p>
				)}
			</div>
		</div>
	);
}
