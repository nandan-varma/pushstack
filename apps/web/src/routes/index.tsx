import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { BuiltWithItself } from "@/components/home/BuiltWithItself";
import { LiveRepoPreview } from "@/components/home/LiveRepoPreview";
import { ShippingFeatures } from "@/components/home/ShippingFeatures";
import { useDemoRepository } from "@/components/home/useDemoRepository";
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
	const { commits, branch } = useDemoRepository();
	const compareSpec = commits?.[1]
		? `${commits[1].sha}...${branch}`
		: undefined;
	return (
		<div className="overflow-hidden">
			<Hero />
			<ShippingFeatures compareSpec={compareSpec} />
			<ApiSection restOperations={restOperations} />
			<BuiltWithItself />
			<FinalCta />
		</div>
	);
}

function Hero() {
	return (
		<section className="relative isolate border-b border-bjork-border-muted">
			<div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_55%_at_80%_0%,var(--bjork-accent-soft),transparent)]" />
			<div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:pt-20 lg:pb-24">
				<div className="rise-in min-w-0">
					<p className="font-mono text-[11px] font-medium tracking-[0.14em] text-bjork-accent uppercase">
						Your next project starts here
					</p>
					<h1 className="mt-4 text-[2.75rem] leading-[1.05] font-semibold tracking-[-0.045em] text-balance text-bjork-text sm:text-6xl">
						A new home for your code. Keep the way you work.
					</h1>
					<p className="mt-5 max-w-xl text-lg leading-8 text-pretty text-bjork-text-muted">
						Bring your code, your ideas, and the people you build with.
						PushStack keeps your repositories, issues, and pull requests
						together, with the familiar tools and workflows you already know.
					</p>
					<div className="mt-8 flex flex-wrap gap-3">
						<Link to="/signup" className={buttonVariants({ size: "lg" })}>
							Make yourself at home
							<ArrowRight aria-hidden="true" />
						</Link>
						<Link
							to="/$owner/$name"
							params={DEMO_REPO}
							className={buttonVariants({ variant: "outline", size: "lg" })}
						>
							Take a look around
						</Link>
					</div>
				</div>
				<div className="rise-in min-w-0 [animation-delay:120ms]">
					<LiveRepoPreview />
				</div>
			</div>
		</section>
	);
}

function ApiSection({ restOperations }: { restOperations: number }) {
	return (
		<section
			aria-labelledby="api-heading"
			className="border-y border-bjork-border-muted bg-bjork-panel"
		>
			<div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
				<div>
					<h2
						id="api-heading"
						className="text-3xl font-semibold tracking-[-0.035em] text-bjork-text"
					>
						Your tools can come with you.
					</h2>
					<p className="mt-4 leading-7 text-bjork-text-muted">
						You’ve put time into your workflow. Keep using the GitHub CLI and
						the API requests you know, with PushStack as their new address. We
						check {restOperations} REST operations for compatibility, and our
						GraphQL API supports the requests <code>gh</code> needs.
					</p>
					<Link
						to="/about"
						className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-bjork-accent hover:underline"
					>
						Get to know PushStack
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
		<section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 sm:py-16">
			<div className="flex flex-col items-start justify-between gap-6 rounded-[24px] border border-bjork-border-muted bg-bjork-surface p-8 shadow-(--bjork-shadow-surface) sm:flex-row sm:items-center sm:p-10">
				<div>
					<h2 className="text-2xl font-semibold tracking-[-0.03em] text-bjork-text sm:text-3xl">
						Ready for your first push?
					</h2>
					<p className="mt-2 text-bjork-text-muted">
						Start with a repository. Make something you care about.
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
