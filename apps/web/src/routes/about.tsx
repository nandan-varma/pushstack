import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_REPO } from "@/lib/site";

export const Route = createFileRoute("/about")({
	component: About,
});

const stack = [
	{
		term: "Git",
		detail:
			"Smart HTTP over HTTPS, served by our own git-fs-s3 library on isomorphic-git. No native git binary and no local disk: every object read and write goes to object storage, and each push lands as one pack before any ref moves.",
	},
	{
		term: "Storage",
		detail:
			"Git objects in Cloudflare R2; issues, pull requests, reviews and accounts in Postgres. Writes to a repository take a lease, so concurrent pushes never interleave.",
	},
	{
		term: "API",
		detail:
			"A GitHub-compatible REST API at /api/v3: GitHub's paths, JSON shapes, status codes and pagination, with personal access tokens in the Authorization header.",
	},
];

function About() {
	return (
		<div className="mx-auto max-w-[880px] px-4 py-14 sm:px-6 sm:py-20">
			<p className="font-mono text-[11px] font-medium tracking-[0.14em] text-bjork-accent uppercase">
				About
			</p>
			<h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-balance text-bjork-text sm:text-5xl">
				A fresh start, with familiar ways to work.
			</h1>
			<p className="mt-6 text-lg leading-8 text-bjork-text-muted">
				Your projects come with habits, tools, and people you care about.
				PushStack gives them a new home, with repositories, issues, pull
				requests, and reviews in one place. We follow GitHub’s conventions so
				you have less to relearn, from opening a pull request to using the CLI
				and APIs. Here’s a little about what’s underneath.
			</p>

			<dl className="mt-12 divide-y divide-bjork-border-muted rounded-[18px] border border-bjork-border-muted bg-bjork-surface shadow-(--bjork-shadow-surface)">
				{stack.map(({ term, detail }) => (
					<div
						key={term}
						className="grid gap-2 px-6 py-5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-6"
					>
						<dt className="text-sm font-semibold text-bjork-text">{term}</dt>
						<dd className="text-sm leading-6 text-bjork-text-muted">
							{detail}
						</dd>
					</div>
				))}
			</dl>

			<div className="mt-12 flex flex-wrap gap-3">
				<Link
					to="/$owner/$name"
					params={DEMO_REPO}
					className={buttonVariants({ size: "lg" })}
				>
					Read the source
					<ArrowRight aria-hidden="true" />
				</Link>
				<a
					href="https://docs.git.nandan.fyi"
					className={buttonVariants({ variant: "outline", size: "lg" })}
				>
					Documentation
				</a>
			</div>
		</div>
	);
}
