import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Check,
	Cloud,
	GitBranch,
	GitPullRequest,
	LockKeyhole,
	MessageSquare,
	Sparkles,
	Terminal,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { SITE_URL } from "../lib/site";

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
								<Link to="/repositories">Explore repositories</Link>
							</Button>
						</div>
						<p
							className="rise-in mt-5 text-sm text-muted-foreground"
							style={{ animationDelay: "320ms" }}
						>
							No migration ceremony. Just point your remote and push.
						</p>
					</div>

					<div
						className="rise-in relative mx-auto mt-14 max-w-5xl"
						style={{ animationDelay: "400ms" }}
					>
						<div className="absolute -inset-x-8 -bottom-12 -z-10 h-40 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--foreground)_10%,transparent),transparent_65%)] blur-2xl" />
						<div className="overflow-hidden rounded-xl border border-border bg-card text-left shadow-2xl shadow-foreground/10">
							<div className="flex h-11 items-center justify-between border-b border-border bg-muted/60 px-4 sm:px-5">
								<div className="flex items-center gap-2 text-sm font-medium">
									<span className="size-2 rounded-full bg-emerald-500" />
									pushstack / pushstack
								</div>
								<span className="hidden rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground sm:block">
									main
								</span>
							</div>
							<div className="grid lg:grid-cols-[1fr_1.12fr]">
								<div className="border-b border-border p-5 sm:p-7 lg:border-r lg:border-b-0">
									<p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
										Shipping now
									</p>
									<h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">
										Make code hosting feel like a tool, not a destination.
									</h2>
									<div className="mt-6 space-y-3">
										<div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
											<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
												<GitPullRequest className="size-4" />
											</span>
											<div className="min-w-0">
												<p className="truncate text-sm font-medium">
													Improve the homepage conversion flow
												</p>
												<p className="mt-0.5 text-xs text-muted-foreground">
													#42 · Ready for review
												</p>
											</div>
											<span className="ml-auto size-2 shrink-0 rounded-full bg-amber-400" />
										</div>
										<div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
											<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
												<MessageSquare className="size-4" />
											</span>
											<div>
												<p className="text-sm font-medium">
													One thoughtful review
												</p>
												<p className="mt-0.5 text-xs text-muted-foreground">
													The context stays with the code.
												</p>
											</div>
										</div>
									</div>
								</div>
								<div className="bg-[#101110] p-5 font-mono text-xs leading-6 text-zinc-300 sm:p-7">
									<div className="mb-5 flex items-center gap-2 text-zinc-500">
										<Terminal className="size-4" /> Your existing workflow
									</div>
									<p>
										<span className="text-emerald-400">$</span> git remote add
										pushstack https://git.nandan.fyi/you/repo.git
									</p>
									<p>
										<span className="text-emerald-400">$</span> git push
										pushstack main
									</p>
									<p className="mt-3 text-zinc-500">
										Enumerating objects: 18, done.
									</p>
									<p className="text-zinc-500">
										Writing objects to R2: 100% (18/18), done.
									</p>
									<p className="mt-3 text-emerald-400">
										✓ main updated · review ready
									</p>
									<p className="mt-4">
										<span className="text-emerald-400">$</span>{" "}
										<span className="animate-pulse">_</span>
									</p>
								</div>
							</div>
						</div>
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
