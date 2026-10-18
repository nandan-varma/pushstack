import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getCloneUrl } from "@/lib/git-utils";
import { CloneModal } from "../CloneModal";

describe("recursive clone command", () => {
	it("copies the selected recursive command and can switch back to a plain clone", async () => {
		const user = userEvent.setup();
		const write = vi.spyOn(navigator.clipboard, "writeText");
		render(<CloneModal owner="alice" repoName="app" />);
		await user.click(screen.getByRole("button", { name: "Clone" }));
		const option = screen.getByRole("checkbox", {
			name: "Include submodules (recursive)",
		});
		expect(option).not.toBeChecked();
		await user.click(option);
		expect(
			screen.getByText(
				`git clone --recurse-submodules ${getCloneUrl("alice", "app")}`,
			),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Copy command" }));
		expect(write).toHaveBeenLastCalledWith(
			`git clone --recurse-submodules ${getCloneUrl("alice", "app")}`,
		);
		await user.click(option);
		expect(
			screen.getByText(`git clone ${getCloneUrl("alice", "app")}`),
		).toBeInTheDocument();
	});
});
