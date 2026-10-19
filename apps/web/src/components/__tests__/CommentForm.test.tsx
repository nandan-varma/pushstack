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

	it("does not call onSubmit when the button is clicked with whitespace-only content", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();

		render(<CommentForm value="   " onChange={() => {}} onSubmit={onSubmit} />);

		// Button should be disabled — verify it can't be triggered
		const button = screen.getByRole("button", { name: "Post Comment" });
		expect(button).toBeDisabled();
		await user.click(button);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("does not call onSubmit when the button is clicked with empty content", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();

		render(<CommentForm value="" onChange={() => {}} onSubmit={onSubmit} />);

		const button = screen.getByRole("button", { name: "Post Comment" });
		expect(button).toBeDisabled();
		await user.click(button);
		expect(onSubmit).not.toHaveBeenCalled();
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
