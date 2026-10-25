import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { IssueFormFields } from "@/components/thread-list/IssueFormFields";
import { issueFormBody } from "@/lib/issue-template-form";
import type { IssueFormElement } from "@/lib/repository-templates";

describe("issue form fields", () => {
	it("labels required text inputs and applies defaults", () => {
		render(
			<IssueFormFields
				elements={[
					{
						type: "input",
						id: "version",
						attributes: {
							label: "Version",
							value: "1.0",
							description: "Which release?",
						},
						validations: { required: true },
					},
					{
						type: "textarea",
						attributes: { label: "Steps", placeholder: "How to reproduce" },
					},
				]}
			/>,
		);
		expect(screen.getByLabelText("Version (required)")).toBeRequired();
		expect(screen.getByLabelText("Version (required)")).toHaveValue("1.0");
		expect(
			screen.getByLabelText("Version (required)"),
		).toHaveAccessibleDescription("Which release?");
		expect(screen.getByLabelText("Steps")).not.toBeRequired();
	});
	it("renders dropdown defaults and required checklist entries", () => {
		render(
			<IssueFormFields
				elements={[
					{
						type: "dropdown",
						attributes: {
							label: "Platform",
							options: ["Linux", "macOS"],
							default: 1,
						},
						validations: { required: true },
					},
					{
						type: "checkboxes",
						attributes: {
							label: "Checks",
							options: [
								{ label: "Read guidelines", required: true },
								{ label: "Tested" },
							],
						},
					},
				]}
			/>,
		);
		expect(screen.getByLabelText("Platform (required)")).toHaveValue("macOS");
		expect(screen.getByLabelText("Read guidelines (required)")).toBeRequired();
		expect(screen.getByLabelText("Tested")).not.toBeRequired();
	});
	it("serializes the actual rendered controls into Markdown", async () => {
		const user = userEvent.setup();
		const elements: IssueFormElement[] = [
			{
				type: "dropdown",
				attributes: {
					label: "Platform",
					options: ["Linux", "macOS"],
					multiple: true,
				},
			},
			{
				type: "checkboxes",
				attributes: { label: "Checks", options: [{ label: "Tested" }] },
			},
			{ type: "textarea", attributes: { label: "Logs", render: "text" } },
		];
		const { container } = render(
			<form>
				<IssueFormFields elements={elements} />
			</form>,
		);
		await user.selectOptions(screen.getByLabelText("Platform"), [
			"Linux",
			"macOS",
		]);
		await user.click(screen.getByLabelText("Tested"));
		await user.type(screen.getByLabelText("Logs"), "hello");
		const form = container.querySelector("form");
		if (!form) throw new Error("Expected rendered form");
		expect(issueFormBody(elements, new FormData(form))).toBe(
			"### Platform\n\nLinux, macOS\n\n### Checks\n\n- [X] Tested\n\n### Logs\n\n```text\nhello\n```",
		);
	});
});
