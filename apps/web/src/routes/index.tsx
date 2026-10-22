import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Braces,
	FolderTree,
	Inbox,
	type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { LiveRepoPreview } from "@/components/home/LiveRepoPreview";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_REPO, SITE_URL } from "@/lib/site";
import { getSiteStats } from "@/server/site-stats";

export const Route = createFileRoute("/")({
	head: () => ({ links: [{ rel: "canonical", href: SITE_URL }] }),
	loader: () => getSiteStats(),
	component: LandingPage,
});

function LandingPage() {
	const { restOperations } = Route.useLoaderData();
	return (
		<div className="overflow-hidden">
			<Hero />
			<section
				aria-labelledby="why-heading"
				className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24"
			>
				<h2
					id="why-heading"
					className="max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-bjork-text sm:text-4xl"
				>
					Built around the work, not around a page layout.
				</h2>
				<div className="mt-10 grid gap-4 md:grid-cols-3">
					<Feature
						icon={FolderTree}
						title="A workbench for code"
						body="The file tree stays open beside the file you're reading. Move through a repository without bouncing between lists."
					/>
					<Feature
						icon={Inbox}
						title="Triage like an inbox"
						body="Issues and pull requests open beside their list. Read, label, assign and merge without losing your place."
					/>
					<Feature
						icon={Braces}
						title="GitHub's API, as is"
						body={`${restOperations} REST operations with GitHub's paths, JSON and status codes. Point your scripts at a new base URL and keep going.`}
					/>
				</div>
			</section>
			<ApiSection restOperations={restOperations} />
			<FinalCta />
		</div>
	);
}

function Hero() {
	return (
		<section className="relative isolate border-b border-bjork-border-muted">
			<div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_55%_at_80%_0%,var(--bjork-accent-soft),transparent)]" />
			<div className="mx-auto grid max-w-[1200px] gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:pt-20 lg:pb-24">
				<div className="rise-in">
					<p className="font-mono text-[11px] font-medium tracking-[0.14em] text-bjork-accent uppercase">
						Git hosting · GitHub-compatible
					</p>
					<h1 className="mt-4 text-[2.75rem] leading-[1.05] font-semibold tracking-[-0.045em] text-balance text-bjork-text sm:text-6xl">
						Your code, on a forge that speaks GitHub.
					</h1>
					<p className="mt-5 max-w-xl text-lg leading-8 text-pretty text-bjork-text-muted">
						Push over HTTPS, review in a split-view inbox, and script it all
						with the REST API and CLI you already know. Git objects live in
						object storage; nothing runs on a disk you have to babysit.
					</p>
					<div className="mt-8 flex flex-wrap gap-3">
						<Link to="/signup" className={buttonVariants({ size: "lg" })}>
							Get started
							<ArrowRight aria-hidden="true" />
						</Link>
						<Link
							to="/$owner/$name"
							params={DEMO_REPO}
							className={buttonVariants({ variant: "outline", size: "lg" })}
						>
							Browse PushStack's own repo
						</Link>
					</div>
				</div>
				<div className="rise-in [animation-delay:120ms]">
					<LiveRepoPreview />
				</div>
			</div>
		</section>
	);
}

function Feature({
	icon: Icon,
	title,
	body,
}: {
	icon: LucideIcon;
	title: string;
	body: ReactNode;
}) {
	return (
		<article className="rounded-[18px] border border-bjork-border-muted bg-bjork-surface p-6 shadow-(--bjork-shadow-surface)">
			<span className="flex size-10 items-center justify-center rounded-[12px] bg-bjork-accent-soft text-bjork-accent">
				<Icon aria-hidden="true" className="size-5" />
			</span>
			<h3 className="mt-5 text-[15px] font-semibold text-bjork-text">
				{title}
			</h3>
			<p className="mt-2 text-sm leading-6 text-bjork-text-muted">{body}</p>
		</article>
	);
}

function ApiSection({ restOperations }: { restOperations: number }) {
	return (
		<section
			aria-labelledby="api-heading"
			className="border-y border-bjork-border-muted bg-bjork-panel"
		>
			<div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
				<div>
					<h2
						id="api-heading"
						className="text-3xl font-semibold tracking-[-0.035em] text-bjork-text"
					>
						Change the base URL. Keep the tooling.
					</h2>
					<p className="mt-4 leading-7 text-bjork-text-muted">
						The same request, the same JSON back. Personal access tokens work in
						the <code>Authorization</code> header exactly as on GitHub, and
						every one of the {restOperations} operations is checked against a
						shared contract in CI.
					</p>
					<Link
						to="/about"
						className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-bjork-accent hover:underline"
					>
						How PushStack is built
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</div>
				<div className="space-y-3 font-mono text-[13px]">
					<CodeCard label="GitHub" muted>
						curl -H "Authorization: token $GH_TOKEN" \{"\n"}
						{"  "}https://api.github.com/repos/acme/app/issues
					</CodeCard>
					<CodeCard label="PushStack">
						curl -H "Authorization: token $PST_TOKEN" \{"\n"}
						{"  "}
						<span className="text-bjork-accent">{SITE_URL}/api/v3</span>
						/repos/acme/app/issues
					</CodeCard>
				</div>
			</div>
		</section>
	);
}

function CodeCard({
	label,
	muted = false,
	children,
}: {
	label: string;
	muted?: boolean;
	children: ReactNode;
}) {
	return (
		<figure className="overflow-hidden rounded-[16px] border border-bjork-border bg-bjork-field-inset shadow-(--bjork-shadow-inset)">
			<figcaption className="border-b border-bjork-border-muted px-4 py-2 font-sans text-[11px] font-medium tracking-[0.12em] text-bjork-text-soft uppercase">
				{label}
			</figcaption>
			<pre
				className={`overflow-x-auto px-4 py-3 leading-6 whitespace-pre ${muted ? "text-bjork-text-soft" : "text-bjork-text-strong"}`}
			>
				{children}
			</pre>
		</figure>
	);
}

function FinalCta() {
	return (
		<section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24">
			<div className="flex flex-col items-start justify-between gap-6 rounded-[24px] border border-bjork-border-muted bg-bjork-surface p-8 shadow-(--bjork-shadow-surface) sm:flex-row sm:items-center sm:p-10">
				<div>
					<h2 className="text-2xl font-semibold tracking-[-0.03em] text-bjork-text sm:text-3xl">
						Bring a repository.
					</h2>
					<p className="mt-2 text-bjork-text-muted">
						Create an account, push a branch, and open your first pull request.
					</p>
				</div>
				<Link to="/signup" className={buttonVariants({ size: "lg" })}>
					Create your account
					<ArrowRight aria-hidden="true" />
				</Link>
			</div>
		</section>
	);
}
