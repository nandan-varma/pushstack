import { describe, expect, it } from "vitest";
import {
	commaSeparated,
	issueFormBody,
	issueTemplatePrefill,
} from "./issue-template-form";
import type { IssueFormElement } from "./repository-templates";

describe("issue form Markdown", () => {
	it("serializes answers, dropdowns and all checklist options, excluding instructions", () => {
		const elements: IssueFormElement[] = [
			{ type: "markdown", attributes: { value: "Instructions" } },
			{ type: "input", attributes: { label: "Version" } },
			{
				type: "dropdown",
				attributes: {
					label: "Platforms",
					options: ["Linux", "macOS"],
					multiple: true,
				},
			},
			{
				type: "checkboxes",
				attributes: {
					label: "Checks",
					options: [{ label: "Searched", required: true }, { label: "Tested" }],
				},
			},
			{ type: "textarea", attributes: { label: "Details" } },
		];
		const data = new FormData();
		data.set("field-1", "1.0");
		data.append("field-2", "Linux");
		data.append("field-2", "macOS");
		data.set("field-3", "0");
		expect(issueFormBody(elements, data)).toBe(
			"### Version\n\n1.0\n\n### Platforms\n\nLinux, macOS\n\n### Checks\n\n- [X] Searched\n- [ ] Tested\n\n### Details\n\n_No response_",
		);
	});
	it("fences rendered text without allowing embedded fences to escape", () => {
		const data = new FormData();
		data.set("field-0", "```\noutput");
		expect(
			issueFormBody(
				[{ type: "textarea", attributes: { label: "Logs", render: "shell" } }],
				data,
			),
		).toBe("### Logs\n\n````shell\n```\noutput\n````");
	});
	it("splits metadata query parameters", () =>
		expect(commaSeparated(" bug, ,help wanted ")).toEqual([
			"bug",
			"help wanted",
		]));
});

describe("issue template prefills", () => {
	const template = {
		filename: "bug.md",
		name: "Bug",
		description: "Report",
		title: "[Bug] ",
		body: "Details",
		labels: ["BUG", "missing"],
		assignees: ["alice", "missing"],
		form: null,
	};
	it("prefills Markdown and filters unknown template metadata", () => {
		expect(
			issueTemplatePrefill(
				template,
				{},
				{ labels: ["bug"], assignees: ["Alice"] },
			),
		).toEqual({
			title: "[Bug] ",
			body: "Details",
			labels: "BUG",
			assignees: "alice",
		});
	});
	it("query parameters override every template field, including explicit empty values", () => {
		expect(
			issueTemplatePrefill(
				template,
				{ title: "Link title", body: "", labels: "custom", assignees: "" },
				{ labels: [], assignees: [] },
			),
		).toEqual({
			title: "Link title",
			body: "",
			labels: "custom",
			assignees: "",
		});
	});
	it("supports blank issue query prefills", () => {
		expect(
			issueTemplatePrefill(
				undefined,
				{
					title: "From link",
					body: "Report",
					labels: "bug",
					assignees: "alice",
				},
				{ labels: [], assignees: [] },
			),
		).toEqual({
			title: "From link",
			body: "Report",
			labels: "bug",
			assignees: "alice",
		});
	});
});
