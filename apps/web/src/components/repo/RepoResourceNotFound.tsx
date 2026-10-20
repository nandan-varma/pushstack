import { useParams } from "@tanstack/react-router";
import { NotFoundCard } from "@/components/NotFoundCard";

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
