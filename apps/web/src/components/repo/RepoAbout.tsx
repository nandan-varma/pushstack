import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { CalendarDays, GitBranch, Globe, Lock, Star } from "lucide-react";
import type { ReactNode } from "react";
import { CopyField } from "@/components/CopyField";
import { AsideSection } from "@/components/layout/page";
import { getCloneUrl } from "@/lib/git-utils";

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<li className="flex items-center gap-2.5 text-sm text-bjork-text-medium">
			<span className="text-bjork-text-soft [&_svg]:size-4">{icon}</span>
			{children}
		</li>
	);
}

/**
 * The repository root's sidebar: what it is, how to get it, and its numbers.
 * Cloning is one tap here instead of a dialog.
 */
export function RepoAbout({
	owner,
	name,
	repo,
	branchCount,
}: {
	owner: string;
	name: string;
	repo: {
		description: string | null;
		visibility: string;
		defaultBranch: string;
		starCount: number;
		createdAt: Date | string;
	};
	branchCount?: number;
}) {
	return (
		<>
			<AsideSection title="About">
				<p
					className={
						repo.description
							? "text-sm leading-6 text-bjork-text-medium"
							: "text-sm text-bjork-text-soft italic"
					}
				>
					{repo.description || "No description provided."}
				</p>
				<ul className="mt-4 space-y-2.5">
					<Fact icon={repo.visibility === "public" ? <Globe /> : <Lock />}>
						<span className="capitalize">{repo.visibility}</span>
					</Fact>
					<Fact icon={<Star />}>
						<span>
							<span className="font-medium text-bjork-text tabular-nums">
								{repo.starCount}
							</span>{" "}
							{repo.starCount === 1 ? "star" : "stars"}
						</span>
					</Fact>
					{branchCount !== undefined && (
						<Fact icon={<GitBranch />}>
							<Link
								to="/$owner/$name/commits/$branch"
								params={{ owner, name, branch: repo.defaultBranch }}
								className="hover:text-bjork-accent"
							>
								<span className="font-medium text-bjork-text tabular-nums">
									{branchCount}
								</span>{" "}
								{branchCount === 1 ? "branch" : "branches"}
							</Link>
						</Fact>
					)}
					<Fact icon={<CalendarDays />}>
						Created {format(new Date(repo.createdAt), "MMM d, yyyy")}
					</Fact>
				</ul>
			</AsideSection>
			<AsideSection title="Clone">
				<CopyField value={getCloneUrl(owner, name)} label="Copy clone URL" />
				<p className="mt-2 text-xs leading-5 text-bjork-text-soft">
					HTTPS with a personal access token.
				</p>
			</AsideSection>
		</>
	);
}
