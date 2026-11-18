import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	repositoryByNameQueryOptions,
	repositoryWikiPageQueryOptions,
	repositoryWikiQueryOptions,
} from "@/lib/query-options";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

/** GitHub titles a page from its file name: `Second-Page.md` is "Second Page". */
function pageTitle(name: string): string {
	return name.replace(/-/g, " ");
}

export function WikiPage({
	owner,
	name,
	page,
}: {
	owner: string;
	name: string;
	/** The page slug; omitted for the wiki's Home. */
	page?: string;
}) {
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const repoId = repo?.id ?? 0;
	const home = useQuery({
		...repositoryWikiQueryOptions(repoId),
		enabled: !!repo && !page,
	});
	const single = useQuery({
		...repositoryWikiPageQueryOptions(repoId, page ?? "Home"),
		enabled: !!repo && !!page,
	});
	const { data, isLoading } = page ? single : home;

	if (!repo || isLoading || !data) {
		return <Skeleton className="h-96" />;
	}

	const current = data.page;
	const title = pageTitle(current?.name ?? page ?? "Home");
	const linkBase = `/${owner}/${name}/wiki`;
	const newPage = (
		<Link to="/$owner/$name/wiki/$page" params={{ owner, name, page: "_new" }}>
			<Button variant={current ? "outline" : "default"}>New page</Button>
		</Link>
	);

	return (
		<div className="space-y-6">
			<PageHeader title={title} actions={data.canEdit && newPage} />
			<div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
				<article className="min-w-0">
					{current?.tooLarge ? (
						<p className="rounded-lg border border-bjork-border bg-bjork-surface p-4 text-sm text-bjork-text-muted">
							This page is too large to display. Clone the wiki to read it.
						</p>
					) : current?.content != null ? (
						<Suspense fallback={<Skeleton className="h-64" />}>
							<MarkdownRenderer
								content={current.content}
								repoId={repoId}
								filePath={`${current.name}.md`}
								linkBase={linkBase}
							/>
						</Suspense>
					) : (
						<div className="rounded-lg border border-bjork-border bg-bjork-surface p-6">
							<h2 className="text-lg font-semibold text-bjork-text">
								{page ? "This page does not exist yet" : "Welcome to the wiki"}
							</h2>
							<p className="mt-1 text-sm text-bjork-text-muted">
								{data.canEdit
									? "Create it to share documentation for this repository."
									: "Any signed-in user may create it."}
							</p>
							{data.canEdit && (
								<Link
									className="mt-4 inline-block"
									to="/$owner/$name/wiki/$page"
									params={{ owner, name, page: "_new" }}
								>
									<Button>
										{page ? "Create this page" : "Create the first page"}
									</Button>
								</Link>
							)}
						</div>
					)}
				</article>
				{data.pages.length > 0 && (
					<aside className="space-y-2 text-sm">
						<h2 className="text-xs font-semibold tracking-wide text-bjork-text-soft uppercase">
							Pages
						</h2>
						<ul className="space-y-1">
							{data.pages.map((wikiPage) => (
								<li key={wikiPage}>
									<Link
										to="/$owner/$name/wiki/$page"
										params={{ owner, name, page: wikiPage }}
										className="text-bjork-accent hover:underline"
										aria-current={
											current?.name === wikiPage ? "page" : undefined
										}
									>
										{pageTitle(wikiPage)}
									</Link>
								</li>
							))}
						</ul>
					</aside>
				)}
			</div>
			{data.sidebar && (
				<aside className="border-t border-bjork-border-muted pt-4">
					<Suspense fallback={null}>
						<MarkdownRenderer
							content={data.sidebar}
							repoId={repoId}
							filePath="_Sidebar.md"
							linkBase={linkBase}
						/>
					</Suspense>
				</aside>
			)}
			{data.footer && (
				<footer className="border-t border-bjork-border-muted pt-4">
					<Suspense fallback={null}>
						<MarkdownRenderer
							content={data.footer}
							repoId={repoId}
							filePath="_Footer.md"
							linkBase={linkBase}
						/>
					</Suspense>
				</footer>
			)}
		</div>
	);
}
