import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Bell,
	GitCompare,
	GitFork,
	GitMerge,
	type LucideIcon,
	Search,
	ShieldCheck,
	Tag,
	Terminal,
} from "lucide-react";
import type { ReactNode } from "react";
import { DEMO_REPO } from "@/lib/site";

/**
 * What the instance serves today. Each card links to the page of the demo
 * repository that shows the feature; nothing here is on a roadmap.
 */
export function ShippingFeatures() {
	return (
		<section
			aria-labelledby="features-heading"
			className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24"
		>
			<h2
				id="features-heading"
				className="max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-bjork-text sm:text-4xl"
			>
				What this instance serves today.
			</h2>
			<p className="mt-4 max-w-2xl leading-7 text-bjork-text-muted">
				Every card links to PushStack's own repository on this instance.
			</p>
			<div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<Feature
					icon={GitFork}
					title="Forks and pull requests from them"
					body="Fork a repository, open a pull request from the fork's branch, and merge it into the base. The review keeps working after the fork is deleted."
				>
					<Link
						to="/$owner/$name/forks"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						Forks of this repository
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={GitCompare}
					title="Compare, including forks"
					body="Read the commits and files between two branches, and download the comparison as .diff or .patch. The REST API also resolves a fork's owner:branch."
				>
					<Link
						to="/$owner/$name/compare/$"
						params={{ ...DEMO_REPO, _splat: "main" }}
						className={LINK_CLASS}
					>
						Compare branches
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={Terminal}
					title="Stock gh, unmodified"
					body="gh auth login completes with a device code; gh issue and gh pr then list, create, comment, review and merge against this instance."
				>
					<Link
						to="/$owner/$name/issues"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						The issue tracker
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={GitMerge}
					title="Merge commit, squash or rebase"
					body="Each repository allows or refuses each of the three merge methods, and the merge endpoint enforces that choice."
				>
					<Link
						to="/$owner/$name/pulls"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						Review a pull request
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={ShieldCheck}
					title="Signed commits verified"
					body="Commits and tags signed with a GPG or SSH key are checked against the keys on the account, and the API reports the verification."
				>
					<Link
						to="/$owner/$name/commits/$branch"
						params={{ ...DEMO_REPO, branch: "main" }}
						className={LINK_CLASS}
					>
						Commits on main
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={Tag}
					title="Releases"
					body="Publish release notes and downloadable assets for a tag. Drafts stay hidden until they are published."
				>
					<Link
						to="/$owner/$name/releases"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						Releases
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={Search}
					title="Search"
					body="Find repositories and people from the search page, and issues and pull requests from their lists or through the API."
				>
					<Link
						to="/$owner/$name/issues"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						Search the issues
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={Bell}
					title="Notifications"
					body="Mentions, assignments, replies and state changes land in an inbox you can filter and mark read."
				>
					<Link to="/notifications" className={LINK_CLASS}>
						Your inbox
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
			</div>
		</section>
	);
}

const LINK_CLASS =
	"inline-flex items-center gap-1.5 text-sm font-medium text-bjork-accent hover:underline";

function Feature({
	icon: Icon,
	title,
	body,
	children,
}: {
	icon: LucideIcon;
	title: string;
	body: string;
	children: ReactNode;
}) {
	return (
		<article className="flex flex-col rounded-[18px] border border-bjork-border-muted bg-bjork-surface p-6 shadow-(--bjork-shadow-surface)">
			<span className="flex size-10 items-center justify-center rounded-[12px] bg-bjork-accent-soft text-bjork-accent">
				<Icon aria-hidden="true" className="size-5" />
			</span>
			<h3 className="mt-5 text-[15px] font-semibold text-bjork-text">
				{title}
			</h3>
			<p className="mt-2 text-sm leading-6 text-bjork-text-muted">{body}</p>
			<div className="mt-4 pt-1">{children}</div>
		</article>
	);
}
