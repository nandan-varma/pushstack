import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const createForkPullRequest = vi.hoisted(() =>
	vi.fn(async (_input: { data: { repoId: number; title: string } }) => ({
		number: 4,
		owner: "owner",
		name: "app",
	})),
);

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/query-options", () => ({
	queryKeys: {
		repositoryByName: (owner: string, name: string) => [
			"repositories",
			"by-name",
			owner,
			name,
		],
	},
}));
vi.mock("@/server/pull-requests", () => ({ createForkPullRequest }));
vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ toast: vi.fn() }),
}));

import { ForkPullRequestButton } from "../ForkPullRequestButton";

const parent = {
	name: "app",
	defaultBranch: "main",
	owner: { username: "owner" },
};

function renderButton() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ForkPullRequestButton
				repoId={9}
				forkOwner="forker"
				headBranch="feature"
				parent={parent}
			/>
		</QueryClientProvider>,
	);
}

describe("ForkPullRequestButton", () => {
	it("opens the pull request in the parent with the fork's branch as head", async () => {
		createForkPullRequest.mockClear();
		renderButton();

		await userEvent.click(
			screen.getByRole("button", { name: "Open PR from fork" }),
		);
		expect(
			await screen.findByText("Merge forker:feature into owner/app:main"),
		).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText("Title"), "Add a");
		await userEvent.click(
			screen.getByRole("button", { name: "Create pull request" }),
		);

		expect(createForkPullRequest.mock.calls[0]?.[0]).toEqual({
			data: {
				repoId: 9,
				title: "Add a",
				sourceBranchName: "feature",
				targetBranchName: "main",
			},
		});
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/$owner/$name/pull/$id/{-$tab}",
				params: { owner: "owner", name: "app", id: "4" },
			}),
		);
	});
});
