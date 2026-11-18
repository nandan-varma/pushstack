import { Link } from "@tanstack/react-router";

/** A discussion category as GitHub's chip: emoji, name, and a filtered link. */
export function CategoryChip({
	owner,
	name,
	category,
	active,
}: {
	owner: string;
	name: string;
	category: { slug: string; name: string; emoji: string };
	active: boolean;
}) {
	return (
		<Link
			to="/$owner/$name/discussions"
			params={{ owner, name }}
			search={{ category: active ? undefined : category.slug }}
			className={
				active
					? "rounded-full border border-bjork-accent bg-bjork-accent-soft px-2.5 py-1 text-xs font-medium text-bjork-accent"
					: "rounded-full border border-bjork-border px-2.5 py-1 text-xs text-bjork-text-soft hover:bg-bjork-surface-hover"
			}
		>
			<span aria-hidden="true">{category.emoji}</span> {category.name}
		</Link>
	);
}
