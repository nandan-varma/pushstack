import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleDot, GitPullRequest } from "lucide-react";
import { DEMO_REPO } from "@/lib/site";

/** PushStack develops on itself: its backlog and reviews are this instance. */
export function BuiltWithItself() {
	return (
		<section
			aria-labelledby="dogfood-heading"
			className="mx-auto max-w-[1200px] px-4 pt-12 sm:px-6 sm:pt-16"
		>
			<div className="flex flex-col justify-between gap-6 rounded-[20px] border border-bjork-border-muted bg-bjork-surface p-6 sm:p-8 lg:flex-row lg:items-center">
				<div className="min-w-0">
					<h2
						id="dogfood-heading"
						className="text-2xl font-semibold tracking-[-0.03em] text-bjork-text sm:text-3xl"
					>
						We’re building here, too.
					</h2>
					<p className="mt-3 max-w-xl leading-7 text-bjork-text-muted">
						Follow our code, ideas, and reviews in{" "}
						<Link
							to="/$owner/$name"
							params={DEMO_REPO}
							className="font-medium text-bjork-text hover:underline"
						>
							{DEMO_REPO.owner}/{DEMO_REPO.name}
						</Link>
						.
					</p>
				</div>
				<div className="flex shrink-0 flex-wrap gap-3">
					<Link
						to="/$owner/$name/issues"
						params={DEMO_REPO}
						className="inline-flex items-center gap-2 rounded-[12px] border border-bjork-border bg-bjork-field-inset px-4 py-2 text-sm font-medium text-bjork-text hover:bg-bjork-surface-hover"
					>
						<CircleDot aria-hidden="true" className="size-4" />
						Issues
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
					<Link
						to="/$owner/$name/pulls"
						params={DEMO_REPO}
						className="inline-flex items-center gap-2 rounded-[12px] border border-bjork-border bg-bjork-field-inset px-4 py-2 text-sm font-medium text-bjork-text hover:bg-bjork-surface-hover"
					>
						<GitPullRequest aria-hidden="true" className="size-4" />
						Pull requests
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</div>
			</div>
		</section>
	);
}
