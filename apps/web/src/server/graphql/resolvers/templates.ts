/** Repository templates, read from the default branch just as the web chooser. */
import type { IssueTemplate } from "#/lib/repository-templates";
import { listAssignableUsers } from "../../assignees-store";
import { listLabels } from "../../label-store";
import { loadRepositoryTemplates } from "../../repository-templates-store";
import { offsetConnection } from "../connection";
import { encodeNodeId } from "../node-id";
import { loadUser, userNode } from "./core";
import type { Resolvers } from "./generated";
import type { RepositoryNode } from "./repository";

export interface IssueTemplateNode {
	template: IssueTemplate;
	repo: RepositoryNode;
}

export const repositoryTemplateFields = {
	issueTemplates: async (repo, _args, ctx) => {
		const templates = await ctx.memo(`templates:${repo.row.id}`, () =>
			loadRepositoryTemplates(repo.row),
		);
		// GitHub exposes Markdown templates here; YAML forms are web-only.
		return templates.issueTemplates
			.filter((template) => template.form === null)
			.map((template) => ({ template, repo }));
	},
	pullRequestTemplates: async (repo, _args, ctx) => {
		const templates = await ctx.memo(`templates:${repo.row.id}`, () =>
			loadRepositoryTemplates(repo.row),
		);
		return templates.pullRequestTemplates.map((template) => ({
			...template,
			filename: template.filename.split("/").at(-1),
			repository: repo,
		}));
	},
} satisfies Resolvers["Repository"];

export const templateTypeResolvers = {
	IssueTemplate: {
		name: ({ template }) => template.name,
		about: ({ template }) => template.description,
		title: ({ template }) => template.title,
		body: ({ template }) => template.body,
		filename: ({ template }) => template.filename,
		labels: async ({ template, repo }, args, ctx) => {
			const labels = await ctx.memo(`template-labels:${repo.row.id}`, () =>
				listLabels(repo.row.id),
			);
			const wanted = new Set(template.labels.map((name) => name.toLowerCase()));
			const selected = labels.filter((label) =>
				wanted.has(label.name.toLowerCase()),
			);
			return offsetConnection(args, selected.length, async (offset, limit) =>
				selected.slice(offset, offset + limit).map((label) => ({
					...label,
					id: encodeNodeId("Label", label.id),
				})),
			);
		},
		assignees: async ({ template, repo }, args, ctx) => {
			const assignable = await ctx.memo(
				`template-assignees:${repo.row.id}`,
				() => listAssignableUsers(repo.row.id),
			);
			const selected = assignable.filter((user) =>
				template.assignees.includes(user.username),
			);
			return offsetConnection(args, selected.length, async (offset, limit) =>
				Promise.all(
					selected.slice(offset, offset + limit).map(async (user) => {
						const row = await loadUser(ctx, user.id);
						if (!row) throw new Error("Template assignee missing");
						return userNode(row);
					}),
				),
			);
		},
	},
} satisfies Resolvers;
