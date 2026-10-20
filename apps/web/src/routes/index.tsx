import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Check,
	Cloud,
	GitBranch,
	GitPullRequest,
	LockKeyhole,
	Sparkles,
} from "lucide-react";
import { LiveRepoPreview } from "../components/home/LiveRepoPreview";
import { Button } from "../components/ui/button";
import { DEMO_REPO, SITE_URL } from "../lib/site";

export const Route = createFileRoute("/")({
	head: () => ({ links: [{ rel: "canonical", href: SITE_URL }] }),
	component: App,
});

const proofPoints = [
	"Real Git, not an approximation",
	"Issues and pull requests in one place",
	"Objects backed by Cloudflare R2",
];

const capabilities = [
	{
		icon: GitBranch,
		title: "Your Git workflow, intact",
		body: "Clone, branch, commit, push, and inspect history with the commands your team already knows.",
	},
	{
		icon: GitPullRequest,
		title: "Reviews that keep work moving",
		body: "Compare changes, discuss the details, and merge with a clear record of every decision.",
	},
	{
		icon: Cloud,
		title: "Storage built to last",
		body: "Git objects live in Cloudflare R2: durable object storage without a self-managed Git server.",
	},
];

function App() {
	return (
		<main className="overflow-hidden">
			<section className="relative isolate border-b border-border">
				<div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(ellipse_75%_50%_at_50%_-10%,color-mix(in_oklab,var(--foreground)_10%,transparent),transparent)] dark:bg-[radial-gradient(ellipse_75%_50%_at_50%_-10%,color-mix(in_oklab,var(--foreground)_16%,transparent),transparent)]" />
				<div className="page-wrap px-4 pb-20 pt-16 sm:pb-28 sm:pt-24">
					<div className="mx-auto max-w-3xl text-center">
						<div className="rise-in mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
							<span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
								<Sparkles className="size-3" />
							</span>
							We run PushStack on PushStack
						</div>
						<h1
							className="rise-in text-balance text-5xl font-semibold tracking-[-0.06em] text-foreground sm:text-6xl lg:text-7xl"
							style={{ animationDelay: "80ms" }}
						>
							The forge for teams that ship their own way.
						</h1>
						<p
							className="rise-in mx-auto mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl"
							style={{ animationDelay: "160ms" }}
						>
							A focused home for your code, reviews, and decisions. PushStack
							keeps the Git workflow familiar—and the work around it calm.
						</p>
						<div
							className="rise-in mt-9 flex flex-col justify-center gap-3 sm:flex-row"
							style={{ animationDelay: "240ms" }}
						>
							<Button size="lg" className="h-11 px-5 text-sm" asChild>
								<Link to="/auth/register">
									Start building free <ArrowRight className="size-4" />
								</Link>
							</Button>
							<Button
								variant="outline"
								size="lg"
								className="h-11 px-5 text-sm"
								asChild
							>
								<Link to="/$owner/$name" params={DEMO_REPO}>
									Explore a live repo
								</Link>
							</Button>
						</div>
						<p
							className="rise-in mt-5 text-sm text-muted-foreground"
							style={{ animationDelay: "320ms" }}
						>
							No sign-up needed to look around: browse our own source, issues
							and pull requests below.
						</p>
					</div>

					<div
						className="rise-in relative mx-auto mt-14 max-w-5xl"
						style={{ animationDelay: "400ms" }}
					>
						<div className="absolute -inset-x-8 -bottom-12 -z-10 h-40 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--foreground)_10%,transparent),transparent_65%)] blur-2xl" />
						<LiveRepoPreview />
					</div>
				</div>
			</section>

			<section className="page-wrap px-4 py-20 sm:py-28">
				<div className="grid gap-10 lg:grid-cols-[0.9fr_2fr] lg:gap-16">
					<div>
						<p className="island-kicker">Made for the daily work</p>
						<h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
							Everything you need. Nothing to babysit.
						</h2>
						<p className="mt-4 leading-7 text-muted-foreground">
							We built PushStack for the work we do every day, so every part is
							designed to stay out of the way when you are trying to ship.
						</p>
					</div>
					<div className="grid gap-4 sm:grid-cols-3">
						{capabilities.map(({ icon: Icon, title, body }) => (
							<article
								key={title}
								className="group rounded-xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
							>
								<span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
									<Icon className="size-4" />
								</span>
								<h3 className="mt-5 text-sm font-semibold">{title}</h3>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">
									{body}
								</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section className="border-y border-border bg-muted/40">
				<div className="page-wrap grid gap-8 px-4 py-14 sm:grid-cols-[1fr_auto] sm:items-center sm:py-16">
					<div>
						<div className="flex items-center gap-2 text-sm font-semibold">
							<LockKeyhole className="size-4" /> Built with skin in the game
						</div>
						<h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
							The product you see is the product we use to build it.
						</h2>
						<p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
							Our source, issues, and pull requests live here. That keeps the
							feedback loop short and means the rough edges are ours first.
						</p>
					</div>
					<div className="space-y-3 text-sm text-muted-foreground">
						{proofPoints.map((point) => (
							<p key={point} className="flex items-center gap-2">
								<Check className="size-4 text-foreground" />
								{point}
							</p>
						))}
					</div>
				</div>
			</section>

			<section className="page-wrap px-4 py-20 text-center sm:py-28">
				<p className="island-kicker">Ready when you are</p>
				<h2 className="mx-auto mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.045em] sm:text-5xl">
					Put your next push somewhere built for it.
				</h2>
				<p className="mx-auto mt-5 max-w-xl text-pretty leading-7 text-muted-foreground">
					Create your account, bring a repository, and keep your team’s momentum
					in one focused workspace.
				</p>
				<Button size="lg" className="mt-8 h-11 px-5" asChild>
					<Link to="/auth/register">
						Create your account <ArrowRight className="size-4" />
					</Link>
				</Button>
			</section>
		</main>
	);
}
