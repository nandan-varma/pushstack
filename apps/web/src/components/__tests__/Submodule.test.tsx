import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileDiffViewer } from "../FileDiffViewer";
import { SubmoduleCard } from "../repo/SubmoduleCard";

vi.mock("@/lib/syntax-highlight-client", () => ({
	requestHighlightTokens: vi.fn(),
}));
const a = "1".repeat(40),
	b = "2".repeat(40);
describe("submodule views", () => {
	it("shows the pinned revision and safe navigation instead of file downloads", () => {
		render(<SubmoduleCard oid={a} url="../lib.git" owner="alice" name="app" />);
		expect(screen.getByText(a)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Browse pinned commit" }),
		).toHaveAttribute("href", `/alice/lib/tree/${a}`);
		expect(
			screen.queryByRole("link", { name: "Download" }),
		).not.toBeInTheDocument();
	});
	it("keeps missing configuration visible without a bogus link", () => {
		render(<SubmoduleCard oid={a} url={null} owner="alice" name="app" />);
		expect(screen.getByText(/No matching entry/)).toBeInTheDocument();
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});
	it("shows before/after commit IDs in a review, without fetching blobs or syntax highlighting", async () => {
		render(
			<FileDiffViewer
				files={[
					{
						path: "vendor/lib",
						status: "modified",
						kind: "submodule",
						additions: 0,
						deletions: 0,
						patch: "",
						oldEntry: { type: "commit", oid: a, mode: 0o160000 },
						newEntry: { type: "commit", oid: b, mode: 0o160000 },
					},
				]}
			/>,
		);
		expect(await screen.findByText(a)).toBeInTheDocument();
		expect(screen.getByText(b)).toBeInTheDocument();
		expect(screen.getByText("Submodule")).toBeInTheDocument();
		const { requestHighlightTokens } = await import(
			"@/lib/syntax-highlight-client"
		);
		expect(requestHighlightTokens).not.toHaveBeenCalled();
	});
});
