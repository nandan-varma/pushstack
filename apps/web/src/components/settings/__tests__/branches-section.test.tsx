import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query-options";

const getBranchProtectionRules = vi.hoisted(() => vi.fn());
const saveBranchProtectionRule = vi.hoisted(() => vi.fn());
const deleteBranchProtectionRule = vi.hoisted(() => vi.fn());
vi.mock("@/server/branch-protection-settings", () => ({
	getBranchProtectionRules,
	saveBranchProtectionRule,
	deleteBranchProtectionRule,
}));

const { BranchesSection } = await import("../BranchesSection");

const rule = {
	pattern: "main",
	requiresPullRequest: true,
	requiredApprovingReviewCount: 2,
	dismissStaleReviews: false,
	requireCodeOwnerReviews: false,
	requireStatusChecks: true,
	strictStatusChecks: false,
	contexts: ["ci/test"],
	enforceAdmins: true,
	allowForcePushes: false,
	allowDeletions: false,
};

function renderSection(rules: unknown[]) {
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
	});
	client.setQueryData(queryKeys.repoBranchProtection(7), rules);
	getBranchProtectionRules.mockResolvedValue(rules);
	return render(
		<QueryClientProvider client={client}>
			<BranchesSection repoId={7} />
		</QueryClientProvider>,
	);
}

afterEach(() => vi.clearAllMocks());

describe("BranchesSection", () => {
	it("lists the rules with what each requires", () => {
		renderSection([rule]);
		expect(screen.getByText("main")).toBeInTheDocument();
		expect(
			screen.getByText(
				"2 approving reviews · checks: ci/test · admins included",
			),
		).toBeInTheDocument();
	});

	it("saves a new rule and reloads the list", async () => {
		const user = userEvent.setup();
		saveBranchProtectionRule.mockResolvedValue({
			...rule,
			pattern: "release/*",
		});
		renderSection([]);
		expect(screen.getByText("No branch is protected yet.")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Add a rule" }));
		await user.type(
			screen.getByLabelText(/Branch name or pattern/),
			"release/*",
		);
		await user.click(screen.getByRole("button", { name: "Save rule" }));

		await waitFor(() =>
			expect(saveBranchProtectionRule.mock.calls[0]?.[0]).toEqual({
				data: expect.objectContaining({
					repoId: 7,
					pattern: "release/*",
					requiresPullRequest: true,
					requiredApprovingReviewCount: 1,
					requireStatusChecks: false,
					contexts: [],
				}),
			}),
		);
		await waitFor(() => expect(getBranchProtectionRules).toHaveBeenCalled());
	});

	it("edits a rule without changing its pattern", async () => {
		const user = userEvent.setup();
		saveBranchProtectionRule.mockResolvedValue(rule);
		renderSection([rule]);

		await user.click(screen.getByRole("button", { name: "Edit" }));
		const pattern = screen.getByLabelText(/Branch name or pattern/);
		expect(pattern).toBeDisabled();
		await user.click(screen.getByRole("button", { name: "Save rule" }));

		await waitFor(() =>
			expect(saveBranchProtectionRule.mock.calls[0]?.[0]).toEqual({
				data: expect.objectContaining({
					pattern: "main",
					contexts: ["ci/test"],
				}),
			}),
		);
	});

	it("deletes a rule", async () => {
		const user = userEvent.setup();
		deleteBranchProtectionRule.mockResolvedValue({ pattern: "main" });
		renderSection([rule]);

		await user.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() =>
			expect(deleteBranchProtectionRule.mock.calls[0]?.[0]).toEqual({
				data: { repoId: 7, pattern: "main" },
			}),
		);
	});

	it("shows the server's refusal", async () => {
		const user = userEvent.setup();
		deleteBranchProtectionRule.mockRejectedValue(
			new Error("Only the repository owner can change branch protection"),
		);
		renderSection([rule]);

		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(
			await screen.findByText(
				"Only the repository owner can change branch protection",
			),
		).toBeInTheDocument();
	});
});
