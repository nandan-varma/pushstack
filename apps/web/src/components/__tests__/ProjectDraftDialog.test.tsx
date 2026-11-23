import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectDraftDialog } from "@/components/project/ProjectDraftDialog";

const onClose = vi.fn();
const onSubmit = vi.fn();

function renderDialog(props: {
	initial: { title: string; body: string | null };
	submitLabel: string;
}) {
	return render(
		<ProjectDraftDialog
			open
			onOpenChange={onClose}
			pending={false}
			onSubmit={onSubmit}
			{...props}
		/>,
	);
}

describe("ProjectDraftDialog", () => {
	it("submits a new draft's title and body", async () => {
		const user = userEvent.setup();
		renderDialog({
			initial: { title: "", body: null },
			submitLabel: "Add draft",
		});
		expect(screen.getByRole("button", { name: "Add draft" })).toBeDisabled();
		await user.type(screen.getByLabelText("Title"), "Write docs");
		await user.type(screen.getByLabelText("Body"), "Soon");
		await user.click(screen.getByRole("button", { name: "Add draft" }));
		expect(onSubmit).toHaveBeenCalledWith({
			title: "Write docs",
			body: "Soon",
		});
	});

	it("seeds the form with the draft being edited", async () => {
		const user = userEvent.setup();
		renderDialog({
			initial: { title: "Old title", body: "Old body" },
			submitLabel: "Save draft",
		});
		await user.clear(screen.getByLabelText("Title"));
		await user.type(screen.getByLabelText("Title"), "New title");
		await user.click(screen.getByRole("button", { name: "Save draft" }));
		expect(onSubmit).toHaveBeenCalledWith({
			title: "New title",
			body: "Old body",
		});
	});

	it("shows the server's error", () => {
		render(
			<ProjectDraftDialog
				open
				onOpenChange={onClose}
				initial={{ title: "T", body: null }}
				submitLabel="Add draft"
				pending={false}
				error="A draft title is at most 256 characters"
				onSubmit={onSubmit}
			/>,
		);
		expect(
			screen.getByText("A draft title is at most 256 characters"),
		).toBeInTheDocument();
	});
});
