import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

export function RepositoryListEmptyState() {
	return (
		<EmptyState
			message="No repositories yet."
			action={
				<Link to="/repositories/new">
					<Button size="sm">Create your first repository</Button>
				</Link>
			}
		/>
	);
}
