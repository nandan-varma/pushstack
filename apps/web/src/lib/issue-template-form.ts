import type { IssueFormElement } from "./repository-templates";

/** GitHub stores form responses as headings and Markdown, omitting instructional Markdown. */
export function issueFormBody(
	elements: IssueFormElement[],
	data: FormData,
): string {
	return elements
		.flatMap((element, index) => {
			if (element.type === "markdown") return [];
			const values = data.getAll(`field-${index}`).map(String);
			const options = element.attributes.options ?? [];
			let value =
				element.type === "checkboxes"
					? options
							.map(
								(option, i) =>
									`- [${values.includes(String(i)) ? "X" : " "}] ${typeof option === "string" ? option : option.label}`,
							)
							.join("\n")
					: values.join(", ").trim();
			if (!value) value = "_No response_";
			else if (element.type === "textarea" && element.attributes.render) {
				const fence = "`".repeat(
					Math.max(
						3,
						...(value.match(/`+/g) ?? []).map((run) => run.length + 1),
					),
				);
				value = `${fence}${element.attributes.render}\n${value}\n${fence}`;
			}
			return [`### ${element.attributes.label}\n\n${value}`];
		})
		.join("\n\n");
}

export function commaSeparated(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

/** Template metadata is advisory; GitHub ignores defaults that do not exist. */
export function issueTemplatePrefill(
	template: import("./repository-templates").IssueTemplate | undefined,
	search: {
		title?: string;
		body?: string;
		labels?: string;
		assignees?: string;
	},
	available: { labels: string[]; assignees: string[] },
) {
	return {
		title: search.title ?? template?.title ?? "",
		body: search.body ?? template?.body ?? "",
		labels:
			search.labels ??
			template?.labels
				.filter((name) =>
					available.labels.some(
						(label) => label.toLowerCase() === name.toLowerCase(),
					),
				)
				.join(", ") ??
			"",
		assignees:
			search.assignees ??
			template?.assignees
				.filter((name) =>
					available.assignees.some(
						(login) => login.toLowerCase() === name.toLowerCase(),
					),
				)
				.join(", ") ??
			"",
	};
}
