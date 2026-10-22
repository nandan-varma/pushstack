import {
	CircleDotIcon,
	CodeIcon,
	GitCompareArrowsIcon,
	HistoryIcon,
} from "@animateicons/react/lucide";
import { createLink } from "@tanstack/react-router";
import type { ComponentProps, ElementType } from "react";
import { useIconAnimation } from "@/components/animated-icon";

import {
	segmentedRailClassName,
	segmentedItemClassName as tabLinkBase,
} from "@/components/segmented-navigation";

export function RepoTabNavSkeleton() {
	return (
		<div className="mb-7">
			<nav className="flex gap-6 p-3">
				{[16, 14, 24, 18].map((width) => (
					<div
						key={width}
						className="h-4 animate-pulse rounded bg-muted"
						style={{ width: `${width * 4}px` }}
					/>
				))}
			</nav>
		</div>
	);
}

/** A repository tab whose icon moves while the tab is hovered or focused. */
function RepoTabAnchor({
	icon: Icon,
	label,
	onMouseEnter,
	onMouseLeave,
	onFocus,
	onBlur,
	...props
}: ComponentProps<"a"> & { icon: ElementType; label: string }) {
	const { ref, triggerProps } = useIconAnimation<HTMLAnchorElement>({
		onMouseEnter,
		onMouseLeave,
		onFocus,
		onBlur,
	});
	return (
		<a {...props} {...triggerProps}>
			<Icon ref={ref} size={16} aria-hidden="true" />
			{label}
		</a>
	);
}

const RepoTab = createLink(RepoTabAnchor);

export function RepoTabNav({
	owner,
	name,
	currentBranch,
	isCodeActive,
	isCommitsActive,
}: {
	owner: string;
	name: string;
	currentBranch: string;
	isCodeActive: boolean;
	isCommitsActive: boolean;
}) {
	return (
		<div className="mb-7">
			<nav aria-label="Repository" className={segmentedRailClassName}>
				<RepoTab
					to="/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch: currentBranch, _splat: "" }}
					className={isCodeActive ? `${tabLinkBase} active` : tabLinkBase}
					activeProps={{ className: "active" }}
					icon={CodeIcon}
					label="Code"
				/>
				<RepoTab
					to="/$owner/$name/issues"
					params={{ owner, name }}
					className={tabLinkBase}
					activeProps={{ className: "active" }}
					icon={CircleDotIcon}
					label="Issues"
				/>
				<RepoTab
					to="/$owner/$name/pulls"
					params={{ owner, name }}
					className={tabLinkBase}
					activeProps={{ className: "active" }}
					icon={GitCompareArrowsIcon}
					label="Pull requests"
				/>
				<RepoTab
					to="/$owner/$name/commits/$branch"
					params={{ owner, name, branch: currentBranch }}
					className={isCommitsActive ? `${tabLinkBase} active` : tabLinkBase}
					activeProps={{ className: "active" }}
					icon={HistoryIcon}
					label="Commits"
				/>
			</nav>
		</div>
	);
}
