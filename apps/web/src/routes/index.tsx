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
		<div className="overflow-hidden">
			<section className="relative isolate">
				<div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(ellipse_75%_50%_at_50%_-10%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent)] dark:bg-[radial-gradient(ellipse_75%_50%_at_50%_-10%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent)]" />
				<div className="page-wrap pt-10 pb-14 sm:pt-16 sm:pb-20">
					<div className="mx-auto max-w-3xl text-center">
						<div className="island-shell rise-in mb-8 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground">
							<span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
								<Sparkles className="size-3" />
							</span>
							A home for code. A place to build.
						</div>
						<h1
							className="rise-in text-balance text-5xl font-medium leading-[1.06] tracking-[-0.055em] text-foreground sm:text-7xl lg:text-8xl"
							style={{ animationDelay: "80ms" }}
						>
							Good code starts <br />
							with a clear space.
						</h1>
						<p
							className="rise-in mx-auto mt-6 max-w-3xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl"
							style={{ animationDelay: "160ms" }}
						>
							Your repositories, reviews, and next big idea. A thoughtfully
							simple Git workspace that keeps you moving.
						</p>
						<div
							className="rise-in mt-9 flex flex-col justify-center gap-3 sm:flex-row"
							style={{ animationDelay: "240ms" }}
						>
							<Button className="px-5" asChild>
								<Link to="/auth/register">
									Create your workspace <ArrowRight className="size-4" />
								</Link>
							</Button>
							<Button variant="outline" className="px-5" asChild>
								<Link to="/$owner/$name" params={DEMO_REPO}>
									Explore PushStack
								</Link>
							</Button>
						</div>
						<p
							className="rise-in mt-5 text-sm text-muted-foreground"
							style={{ animationDelay: "320ms" }}
						>
							Familiar Git commands. Public and private repositories. Your
							workflow.
						</p>
					</div>

					<div
						className="rise-in relative mx-auto mt-14 max-w-5xl"
						style={{ animationDelay: "400ms" }}
					>
						<div className="absolute -inset-x-8 -bottom-12 -z-10 h-40 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_65%)] blur-2xl" />
						<LiveRepoPreview />
					</div>
				</div>
			</section>

			<section className="page-wrap py-14 sm:py-20">
				<div className="grid gap-10 lg:grid-cols-[0.9fr_2fr] lg:gap-16">
					<div>
						<p className="island-kicker">Made for the daily work</p>
						<h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
							Less overhead. More forward motion.
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
								className="group island-shell rounded-[20px] p-6 transition-colors hover:bg-muted/50"
							>
								<span className="flex size-11 items-center justify-center rounded-[13px] bg-primary/10 text-primary">
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

			<section className="page-wrap py-6 sm:py-8">
				<div className="island-shell grid gap-8 rounded-[24px] px-6 py-10 sm:grid-cols-[1fr_auto] sm:items-center sm:p-12">
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

			<section className="page-wrap py-8 text-center sm:py-12">
				<p className="island-kicker">Ready when you are</p>
				<h2 className="mx-auto mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.045em] sm:text-5xl">
					Put your next push somewhere built for it.
				</h2>
				<p className="mx-auto mt-5 max-w-3xl text-pretty leading-7 text-muted-foreground">
					Create your account, bring a repository, and keep your team’s momentum
					in one focused workspace.
				</p>
				<Button className="mt-8 px-5" asChild>
					<Link to="/auth/register">
						Create your account <ArrowRight className="size-4" />
					</Link>
				</Button>
			</section>
		</div>
	);
}
