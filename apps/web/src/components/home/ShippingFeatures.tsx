import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Bell,
	BookOpen,
	Code2,
	GitCompare,
	GitFork,
	GitMerge,
	KanbanSquare,
	Lock,
	type LucideIcon,
	MessagesSquare,
	Search,
	ShieldCheck,
	Tag,
	Terminal,
	Webhook,
} from "lucide-react";
import type { ReactNode } from "react";
import { DEMO_REPO } from "@/lib/site";

/**
 * What the instance serves today. Each card links to the page of the demo
 * repository that shows the feature; nothing here is on a roadmap.
 */
export function ShippingFeatures({ compareSpec }: { compareSpec?: string }) {
	return (
		<section
			aria-labelledby="features-heading"
			className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6 sm:py-20"
		>
			<h2
				id="features-heading"
				className="max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-bjork-text sm:text-4xl"
			>
				Room for the work around your code.
			</h2>
			<p className="mt-4 max-w-2xl leading-7 text-bjork-text-muted">
				From the first idea to the next release, keep your work and its
				conversations together. Explore our own project to see how it feels.
			</p>
			<div className="mt-10 grid auto-rows-fr gap-4 md:grid-cols-2 lg:grid-cols-3">
				<Feature
					icon={GitFork}
					title="Make it your own. Bring it back."
					body="Try an idea in your own fork, then open a pull request to share it. Your review stays around, even if the fork goes away."
				>
					<Link
						to="/$owner/$name/forks"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						Explore the forks
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={GitCompare}
					title="See what changed"
					body="Look through the changes between branches, including forks. Read the commits, check the files, or take a diff with you."
				>
					{compareSpec ? (
						<Link
							to="/$owner/$name/compare/$"
							params={{ ...DEMO_REPO, _splat: compareSpec }}
							className={LINK_CLASS}
						>
							Compare recent changes{" "}
							<ArrowRight aria-hidden="true" className="size-4" />
						</Link>
					) : (
						<a
							href="https://docs.git.nandan.fyi/docs/guide#work-in-the-browser"
							className={LINK_CLASS}
						>
							Explore comparisons{" "}
							<ArrowRight aria-hidden="true" className="size-4" />
						</a>
					)}
				</Feature>
				<Feature
					icon={Terminal}
					title="Stay in your terminal"
					body="Feel more at home on the command line? Use gh to open issues, join a review, and merge a pull request, just as you’re used to."
				>
					<Link
						to="/$owner/$name/issues"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						Explore the issues
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={GitMerge}
					title="Merge your way"
					body="Keep the history that makes sense for your project. Choose merge commits, squash, or rebase, and decide which options your repository allows."
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
					title="Know who’s behind a commit"
					body="Bring your GPG or SSH keys. PushStack checks signed commits and tags against the keys on your account."
				>
					<Link
						to="/$owner/$name/commits/$branch"
						params={{ ...DEMO_REPO, branch: "main" }}
						className={LINK_CLASS}
					>
						Browse the commits
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={Tag}
					title="Releases"
					body="Share what’s new with release notes and downloads. Take your time with a draft, then publish when you’re ready."
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
					body="Find a project, a person, or that issue you remember reading. Search repositories and people, or narrow down a list of issues and pull requests."
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
					body="Keep up with replies, mentions, and work assigned to you. Filter your inbox and mark things read as you go."
				>
					<Link to="/notifications" className={LINK_CLASS}>
						Your inbox
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={MessagesSquare}
					title="Discussions"
					body="Ask a question, talk through an idea, or help someone find an answer. Give conversations a place beside the code."
				>
					<Link
						to="/$owner/$name/discussions"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						Open the discussions
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={BookOpen}
					title="Wikis"
					body="Write down what the next person needs to know. Edit your project’s wiki in the browser, or clone it and write with your own tools."
				>
					<Link
						to="/$owner/$name/wiki"
						params={DEMO_REPO}
						className={LINK_CLASS}
					>
						Read the wiki
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={Code2}
					title="Gists"
					body="Give a useful snippet a home of its own. Share a few files, clone them later, or fork something you’d like to build on."
				>
					<Link to="/gist" className={LINK_CLASS}>
						Browse gists
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={KanbanSquare}
					title="Projects"
					body="Make room for the plan, too. Organize work with custom fields, and see it in a list or table."
				>
					<Link
						to="/users/$login/projects"
						params={{ login: DEMO_REPO.owner }}
						className={LINK_CLASS}
					>
						Explore the projects
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Feature>
				<Feature
					icon={Lock}
					title="Branch protection"
					body="Give important branches a little care. Require reviews and checks before merging, and protect them from force pushes and deletion."
				>
					<a
						href="https://docs.git.nandan.fyi/docs/guide#branch-rules-and-webhooks"
						className={LINK_CLASS}
					>
						Learn about branch rules
						<ArrowRight aria-hidden="true" className="size-4" />
					</a>
				</Feature>
				<Feature
					icon={Webhook}
					title="Webhooks"
					body="Keep other tools in the loop when code is pushed or a conversation moves forward. Check deliveries and send them again when needed."
				>
					<a
						href="https://docs.git.nandan.fyi/docs/guide#branch-rules-and-webhooks"
						className={LINK_CLASS}
					>
						Learn about webhooks
						<ArrowRight aria-hidden="true" className="size-4" />
					</a>
				</Feature>
			</div>
		</section>
	);
}

const LINK_CLASS =
	"group inline-flex min-h-10 items-center gap-2 rounded-md text-sm font-medium text-bjork-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bjork-accent";

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
		<article className="flex h-full flex-col rounded-[18px] border border-bjork-border-muted bg-bjork-surface p-6 shadow-(--bjork-shadow-surface) transition-colors hover:border-bjork-border">
			<span className="flex size-10 items-center justify-center rounded-[12px] bg-bjork-accent-soft text-bjork-accent">
				<Icon aria-hidden="true" className="size-5" />
			</span>
			<h3 className="mt-5 text-base leading-6 font-semibold text-balance text-bjork-text">
				{title}
			</h3>
			<p className="mt-2 text-sm leading-6 text-bjork-text-muted">{body}</p>
			<div className="mt-auto pt-5">{children}</div>
		</article>
	);
}
