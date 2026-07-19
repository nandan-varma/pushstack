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
				<div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.28),transparent_66%)]" />
				<div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.16),transparent_66%)]" />

				<div className="relative flex flex-col gap-12 lg:flex-row lg:items-center">
					<div className="flex-1">
						<p className="island-kicker mb-4">Code hosting, reimagined</p>
						<h1 className="display-title mb-6 max-w-xl text-4xl font-bold leading-[1.05] tracking-tight text-[var(--sea-ink)] sm:text-5xl lg:text-6xl">
							Build, collaborate,
							<br className="hidden sm:block" /> and ship together.
						</h1>
						<p className="mb-8 max-w-md text-base leading-relaxed text-[var(--sea-ink-soft)] sm:text-lg">
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
						<div className="overflow-hidden rounded-xl border border-white/10 bg-[#1a2e3a] shadow-2xl">
							<div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
								<span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
								<span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
								<span className="h-3 w-3 rounded-full bg-[#28c840]" />
							</div>
							<div className="space-y-1 p-5 font-mono text-xs leading-6">
								<p>
									<span className="text-[#60d7cf]">$</span>{" "}
									<span className="text-[#e8efff]">
										git remote add origin \
									</span>
								</p>
								<p className="pl-4 text-[#8de5db]">
									https://git.nandan.fyi/you/repo
								</p>
								<p>
									<span className="text-[#60d7cf]">$</span>{" "}
									<span className="text-[#e8efff]">
										git push -u origin main
									</span>
								</p>
								<p className="text-[#6ec89a]">Enumerating objects: 12</p>
								<p className="text-[#6ec89a]">Writing to R2... done.</p>
								<p className="text-[#6ec89a]">Branch 'main' set upstream.</p>
								<p>
									<span className="text-[#60d7cf]">$</span>{" "}
									<span className="animate-pulse text-[#60d7cf]">_</span>
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
						<div className="mb-4 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--lagoon),var(--palm))] text-xs font-bold text-white">
							{label}
						</div>
						<h2 className="mb-2 text-sm font-semibold text-[var(--sea-ink)]">
							{title}
						</h2>
						<p className="text-sm leading-relaxed text-[var(--sea-ink-soft)]">
							{desc}
						</p>
					</article>
				))}
			</section>
		</main>
	);
}
