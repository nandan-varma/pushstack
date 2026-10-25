export interface IssueFormElement {
	type: "markdown" | "input" | "textarea" | "dropdown" | "checkboxes";
	id?: string;
	attributes: {
		label?: string;
		description?: string;
		value?: string;
		placeholder?: string;
		render?: string;
		multiple?: boolean;
		default?: number | number[];
		options?: (string | { label: string; required?: boolean })[];
	};
	validations?: { required?: boolean; min_length?: number };
}

export interface IssueTemplate {
	filename: string;
	name: string;
	description: string;
	title: string;
	body: string;
	labels: string[];
	assignees: string[];
	form: IssueFormElement[] | null;
}

export interface PullRequestTemplate {
	filename: string;
	body: string;
}

export interface RepositoryTemplates {
	issueTemplates: IssueTemplate[];
	pullRequestTemplates: PullRequestTemplate[];
	blankIssuesEnabled: boolean;
	contactLinks: { name: string; url: string; about: string }[];
}
