import { Link } from "@tanstack/react-router";

export function PathBreadcrumb({
	owner,
	name,
	branch,
	filePath,
}: {
	owner: string;
	name: string;
	branch: string;
	filePath: string;
}) {
	if (!filePath) return null;

	const segments = filePath.split("/");

	return (
		<div className="flex flex-wrap items-center gap-1.5 text-sm">
			<Link
				to="/repo/$owner/$name/tree/$branch/$"
				params={{ owner, name, branch, _splat: "" }}
				className="font-medium text-primary hover:underline"
			>
				{name}
			</Link>
			{segments.map((segment, i) => {
				const pathSoFar = segments.slice(0, i + 1).join("/");
				const isLast = i === segments.length - 1;
				return (
					<span key={pathSoFar} className="flex items-center gap-1.5">
						<span className="text-muted-foreground">/</span>
						{isLast ? (
							<span className="font-medium text-foreground">{segment}</span>
						) : (
							<Link
								to="/repo/$owner/$name/tree/$branch/$"
								params={{ owner, name, branch, _splat: pathSoFar }}
								className="font-medium text-primary hover:underline"
							>
								{segment}
							</Link>
						)}
					</span>
				);
			})}
		</div>
	);
}
