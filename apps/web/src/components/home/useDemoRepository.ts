import { useQuery } from "@tanstack/react-query";
import {
	repositoryByNameQueryOptions,
	repositoryCommitsQueryOptions,
} from "@/lib/query-options";
import { DEMO_REPO } from "@/lib/site";

export function useDemoRepository() {
	const { owner, name } = DEMO_REPO;
	const { data: repo, isFetched: repoFetched } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const branch = repo?.defaultBranch ?? "main";
	const { data: commits, isFetched: commitsFetched } = useQuery({
		...repositoryCommitsQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: branch,
			limit: 5,
		}),
		enabled: !!repo,
	});
	return { repo, repoFetched, branch, commits, commitsFetched };
}
