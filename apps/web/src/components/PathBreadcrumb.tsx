import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

/**
 * `repo / dir / file` with every ancestor linked. The current segment is
 * the page's subject, so it renders as the heading when `asHeading` is set.
 */
export function PathBreadcrumb({
	owner,
	name,
	branch,
	filePath,
	asHeading = false,
}: {
	owner: string;
	name: string;
	branch: string;
	filePath: string;
	asHeading?: boolean;
}) {
	if (!filePath) return null;

	const segments = filePath.split("/");
	const Current = asHeading ? "h1" : "span";
	const linkClassName =
		"rounded-[6px] text-bjork-text-muted hover:text-bjork-accent hover:underline underline-offset-4";

	return (
		<nav
			aria-label="File path"
			className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px]"
		>
			<Link
				to="/$owner/$name/tree/$branch/$"
				params={{ owner, name, branch, _splat: "" }}
				className={`${linkClassName} font-medium`}
			>
				{name}
			</Link>
			{segments.map((segment, i) => {
				const pathSoFar = segments.slice(0, i + 1).join("/");
				const isLast = i === segments.length - 1;
				return (
					<Fragment key={pathSoFar}>
						<span aria-hidden="true" className="text-bjork-text-faint">
							/
						</span>
						{isLast ? (
							<Current
								aria-current="page"
								className="min-w-0 break-all text-[15px] font-semibold text-bjork-text"
							>
								{segment}
							</Current>
						) : (
							<Link
								to="/$owner/$name/tree/$branch/$"
								params={{ owner, name, branch, _splat: pathSoFar }}
								className={linkClassName}
							>
								{segment}
							</Link>
						)}
					</Fragment>
				);
			})}
		</nav>
	);
}
