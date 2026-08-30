import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { SITE_URL } from "../lib/site";

export const Route = createFileRoute("/")({
	head: () => ({
		links: [{ rel: "canonical", href: SITE_URL }],
	}),
	component: App,
});

const features = [
	{
		label: "01",
		title: "Git Repositories",
		desc: "Full version control with branches, commits, and history — backed by cloud storage.",
	},
	{
		label: "02",
		title: "Issue Tracking",
		desc: "Track bugs, features, and tasks with a lightweight but powerful issue system.",
	},
	{
		label: "03",
		title: "Pull Requests",
		desc: "Collaborate through code reviews, diffs, and branch merges with your team.",
	},
	{
		label: "04",
		title: "R2 Storage",
		desc: "Git objects stored in Cloudflare R2 — durable, fast, and globally distributed.",
	},
];

function App() {
	return (
		<main className="page-wrap px-4 pb-16 pt-10">
			{/* Hero */}
			<section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-12 sm:px-12 sm:py-16">
				<div className="relative flex flex-col gap-12 lg:flex-row lg:items-center">
					<div className="flex-1">
						<p className="island-kicker mb-4">Code hosting, reimagined</p>
						<h1 className="mb-6 max-w-xl text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
							Build, collaborate,
							<br className="hidden sm:block" /> and ship together.
						</h1>
						<p className="mb-8 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
							A modern code hosting platform with full Git support, issue
							tracking, pull requests, and cloud-native R2 storage.
						</p>
						<div className="flex flex-wrap gap-3">
							<Link to="/auth/register">
								<Button size="lg">Get started free</Button>
							</Link>
							<Link to="/auth/login">
								<Button variant="outline" size="lg">
									Sign in
								</Button>
							</Link>
						</div>
					</div>

					{/* Terminal */}
					<div className="hidden w-80 shrink-0 lg:block">
						<div className="overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
							<div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
								<span className="h-3 w-3 rounded-full bg-muted-foreground/40" />
								<span className="h-3 w-3 rounded-full bg-muted-foreground/60" />
								<span className="h-3 w-3 rounded-full bg-muted-foreground/80" />
							</div>
							<div className="space-y-1 p-5 font-mono text-xs leading-6">
								<p>
									<span className="text-muted-foreground">$</span>{" "}
									<span className="text-foreground">
										git remote add origin \
									</span>
								</p>
								<p className="pl-4 text-muted-foreground">
									https://git.nandan.fyi/you/repo
								</p>
								<p>
									<span className="text-muted-foreground">$</span>{" "}
									<span className="text-foreground">
										git push -u origin main
									</span>
								</p>
								<p className="text-muted-foreground">Enumerating objects: 12</p>
								<p className="text-muted-foreground">Writing to R2... done.</p>
								<p className="text-muted-foreground">
									Branch 'main' set upstream.
								</p>
								<p>
									<span className="text-muted-foreground">$</span>{" "}
									<span className="animate-pulse text-muted-foreground">_</span>
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{features.map(({ label, title, desc }, index) => (
					<article
						key={title}
						className="island-shell feature-card rise-in rounded-2xl p-6"
						style={{ animationDelay: `${index * 80 + 100}ms` }}
					>
						<div className="mb-4 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
							{label}
						</div>
						<h2 className="mb-2 text-sm font-semibold text-foreground">
							{title}
						</h2>
						<p className="text-sm leading-relaxed text-muted-foreground">
							{desc}
						</p>
					</article>
				))}
			</section>
		</main>
	);
}
