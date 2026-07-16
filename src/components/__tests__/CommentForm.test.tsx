import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommentForm } from "@/components/CommentForm";

describe("CommentForm", () => {
	it("gives the textarea an accessible name via the heading", () => {
		render(<CommentForm value="" onChange={() => {}} onSubmit={() => {}} />);

		// Regression test for the missing-label a11y bug: the textarea should be
		// reachable by its accessible name, not just by role.
		expect(
			screen.getByRole("textbox", { name: "Add a Comment" }),
		).toBeInTheDocument();
	});

	it("disables Post Comment until there is non-whitespace content", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();

		const { rerender } = render(
			<CommentForm value="" onChange={onChange} onSubmit={() => {}} />,
		);

		expect(screen.getByRole("button", { name: "Post Comment" })).toBeDisabled();

		rerender(
			<CommentForm value="   " onChange={onChange} onSubmit={() => {}} />,
		);
		expect(screen.getByRole("button", { name: "Post Comment" })).toBeDisabled();

		rerender(
			<CommentForm value="hi" onChange={onChange} onSubmit={() => {}} />,
		);
		expect(
			screen.getByRole("button", { name: "Post Comment" }),
		).not.toBeDisabled();

		await user.type(
			screen.getByRole("textbox", { name: "Add a Comment" }),
			"!",
		);
		expect(onChange).toHaveBeenCalled();
	});

	it("calls onSubmit when Post Comment is clicked", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();

		render(
			<CommentForm
				value="a real comment"
				onChange={() => {}}
				onSubmit={onSubmit}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Post Comment" }));
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("disables the form while a submission is pending", () => {
		render(
			<CommentForm
				value="hi"
				onChange={() => {}}
				onSubmit={() => {}}
				isPending
			/>,
		);

		expect(screen.getByRole("button", { name: /Posting…/ })).toBeDisabled();
	});
});
