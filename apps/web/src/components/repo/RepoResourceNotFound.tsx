import { useParams } from "@tanstack/react-router";
import { NotFoundCard } from "@/components/NotFoundCard";

/** Not-found card for a page inside a repository: links back to the repo. */
export function RepoResourceNotFound({
	title,
	message,
}: {
	title: string;
	message: string;
}) {
	const { owner, name } = useParams({ from: "/$owner/$name" });
	return (
		<NotFoundCard
			title={title}
			message={message}
			backTo="/$owner/$name"
			backParams={{ owner, name }}
			backLabel="Back to repository"
		/>
	);
}
