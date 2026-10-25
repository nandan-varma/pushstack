/** Default-branch template discovery shared by the web UI and GraphQL. */
import type { TreeEntry } from "git-fs-s3/ops";
import { parse } from "yaml";
import { z } from "zod";
import {
	MAX_ASSIGNEES,
	MAX_BODY_CHARS,
	MAX_LABEL_NAME_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_TEMPLATE_FILE_BYTES,
	MAX_TEMPLATE_FILES,
	MAX_TEMPLATE_TOTAL_BYTES,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import type {
	IssueTemplate,
	RepositoryTemplates,
} from "#/lib/repository-templates";
import { getBlobByOid, getBlobSizes, getBranches, getTree } from "./git-read";
import { ownerKeyOf } from "./git-storage-naming";
import { createTtlCoalescedCache } from "./ttl-cache";

const text = z.string().max(MAX_BODY_CHARS);
const names = z
	.union([text, z.array(text)])
	.optional()
	.transform((value) =>
		typeof value === "string"
			? value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean)
			: (value ?? []),
	);
const metadata = z.object({
	name: text.min(1),
	title: z.string().max(MAX_THREAD_TITLE_CHARS).default(""),
	labels: names.pipe(
		z.array(z.string().max(MAX_LABEL_NAME_CHARS)).max(MAX_LABELS_PER_THREAD),
	),
	assignees: names.pipe(z.array(z.string().max(100)).max(MAX_ASSIGNEES)),
});
const element = z
	.object({
		type: z.enum(["markdown", "input", "textarea", "dropdown", "checkboxes"]),
		id: text.optional(),
		attributes: z.object({
			label: text.optional(),
			description: text.optional(),
			value: text.optional(),
			placeholder: text.optional(),
			render: text.optional(),
			multiple: z.boolean().optional(),
			default: z
				.union([
					z.number().int().nonnegative(),
					z.array(z.number().int().nonnegative()),
				])
				.optional(),
			options: z
				.array(
					z.union([
						text,
						z.object({ label: text, required: z.boolean().optional() }),
					]),
				)
				.optional(),
		}),
		validations: z
			.object({
				required: z.boolean().optional(),
				min_length: z
					.number()
					.int()
					.nonnegative()
					.max(MAX_BODY_CHARS)
					.optional(),
			})
			.optional(),
	})
	.superRefine((item, ctx) => {
		if (item.type === "markdown") {
			if (!item.attributes.value)
				ctx.addIssue({
					code: "custom",
					message: "Markdown fields need a value",
				});
		} else {
			if (!item.attributes.label)
				ctx.addIssue({ code: "custom", message: "Form fields need a label" });
			if (
				item.type === "dropdown" &&
				(!item.attributes.options?.length ||
					item.attributes.options.some((option) => typeof option !== "string"))
			)
				ctx.addIssue({
					code: "custom",
					message: "Dropdown fields need string options",
				});
			if (
				item.type === "checkboxes" &&
				(!item.attributes.options?.length ||
					item.attributes.options.some((option) => typeof option === "string"))
			)
				ctx.addIssue({
					code: "custom",
					message: "Checkbox fields need labeled options",
				});
		}
	});
const formSchema = metadata
	.extend({ description: text.min(1), body: z.array(element).min(1).max(100) })
	.superRefine((form, ctx) => {
		if (!form.body.some((field) => field.type !== "markdown"))
			ctx.addIssue({
				code: "custom",
				message: "Issue forms must accept user input",
			});
		const ids = form.body.flatMap((field) => (field.id ? [field.id] : []));
		if (new Set(ids).size !== ids.length)
			ctx.addIssue({
				code: "custom",
				message: "Form field IDs must be unique",
			});
	});
const configSchema = z.object({
	blank_issues_enabled: z.boolean().default(true),
	contact_links: z
		.array(
			z.object({
				name: text.min(1),
				url: z
					.url()
					.refine(
						(value) => /^https?:\/\//i.test(value),
						"Contact links must use HTTP or HTTPS",
					),
				about: text.min(1),
			}),
		)
		.default([]),
});

function yaml(source: string): unknown {
	return parse(source, { maxAliasCount: 0 });
}
function issueTemplate(filename: string, source: string): IssueTemplate {
	if (/\.ya?ml$/i.test(filename)) {
		const form = formSchema.parse(yaml(source));
		return {
			filename,
			name: form.name,
			description: form.description,
			title: form.title,
			body: "",
			labels: form.labels,
			assignees: form.assignees,
			form: form.body,
		};
	}
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
	if (!frontmatter)
		throw new Error(`Issue template ${filename} needs YAML frontmatter`);
	const parsed = metadata
		.extend({ about: text.min(1) })
		.parse(yaml(frontmatter[1] ?? ""));
	return {
		filename,
		name: parsed.name,
		description: parsed.about,
		title: parsed.title,
		body: source.slice(frontmatter[0].length),
		labels: parsed.labels,
		assignees: parsed.assignees,
		form: null,
	};
}
const cache = createTtlCoalescedCache<RepositoryTemplates>({
	ttlMs: 60_000,
	maxEntries: 100,
});
const empty = (): RepositoryTemplates => ({
	issueTemplates: [],
	pullRequestTemplates: [],
	blankIssuesEnabled: true,
	contactLinks: [],
});

export async function loadRepositoryTemplates(repo: {
	name: string;
	defaultBranch: string;
	owner: { username: string };
}): Promise<RepositoryTemplates> {
	const owner = ownerKeyOf(repo);
	const branches = await getBranches(owner, repo.name);
	if (branches.length === 0) return empty();
	const branch = branches.find((item) => item.name === repo.defaultBranch);
	if (!branch)
		throw new Error(`Default branch ${repo.defaultBranch} does not exist`);
	const commit = branch.commit;
	return cache.get(`${owner}/${repo.name}:${commit}`, async () => {
		const result = empty();
		let totalBytes = 0;
		let fileCount = 0;
		function withinFileLimit(): boolean {
			return fileCount++ < MAX_TEMPLATE_FILES;
		}
		// Sizes for every blob this discovery may read come from one batched lookup
		// (see `candidates` below), filled in before any file is read.
		let sizes = new Map<string, number>();
		async function read(entry: TreeEntry): Promise<string | undefined> {
			if (totalBytes >= MAX_TEMPLATE_TOTAL_BYTES) return undefined;
			const size = sizes.get(entry.oid);
			if (size === undefined)
				throw new Error(`Template ${entry.path} was not sized`);
			if (size > MAX_TEMPLATE_FILE_BYTES) return undefined;
			if (totalBytes + size > MAX_TEMPLATE_TOTAL_BYTES) {
				totalBytes = MAX_TEMPLATE_TOTAL_BYTES;
				return undefined;
			}
			totalBytes += size;
			const bytes = await getBlobByOid(owner, repo.name, entry.oid);
			try {
				return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch {
				return undefined;
			}
		}
		const root = await getTree(owner, repo.name, commit);
		async function directory(
			entries: TreeEntry[],
			name: string,
		): Promise<TreeEntry[]> {
			const entry = entries.find(
				(item) => item.type === "tree" && item.path.split("/").at(-1) === name,
			);
			return entry ? getTree(owner, repo.name, commit, entry.path) : [];
		}
		const github = await directory(root, ".github");
		const issueFiles = await directory(github, "ISSUE_TEMPLATE");
		const docs = await directory(root, "docs");
		const dirs = [github, root, docs];
		const isDefault = (item: TreeEntry) =>
			item.type === "blob" &&
			item.mode !== "120000" &&
			/^pull_request_template\.md$/i.test(item.path.split("/").at(-1) ?? "");
		const prFolders: TreeEntry[][] = [];
		for (const entries of dirs) {
			const folder = entries.find(
				(item) =>
					item.type === "tree" &&
					item.path.split("/").at(-1)?.toLowerCase() ===
						"pull_request_template",
			);
			prFolders.push(
				folder
					? (await getTree(owner, repo.name, commit, folder.path))
							.filter(
								(item) =>
									item.type === "blob" &&
									item.mode !== "120000" &&
									/\.md$/i.test(item.path),
							)
							.sort((a, b) => a.path.localeCompare(b.path))
					: [],
			);
		}
		const issueBlobs = issueFiles
			.filter(
				(item) =>
					item.type === "blob" &&
					item.mode !== "120000" &&
					/\.(md|ya?ml)$/i.test(item.path.split("/").at(-1) ?? item.path),
			)
			.sort((a, b) => a.path.localeCompare(b.path));
		// Each list is consumed in order and capped by withinFileLimit, so its first
		// MAX_TEMPLATE_FILES entries cover everything that can be read.
		const candidates = [
			...issueBlobs.slice(0, MAX_TEMPLATE_FILES),
			...dirs.flatMap((entries) => entries.filter(isDefault)),
			...prFolders.flatMap((list) => list.slice(0, MAX_TEMPLATE_FILES)),
		];
		const oids = [...new Set(candidates.map((entry) => entry.oid))];
		if (oids.length > 0) sizes = await getBlobSizes(owner, repo.name, oids);
		for (const entry of issueBlobs) {
			const filename = entry.path.split("/").at(-1) ?? entry.path;
			if (!withinFileLimit()) break;
			// Storage failures remain visible; malformed repository files are omitted.
			const source = await read(entry);
			if (source === undefined) continue;
			try {
				if (/^config\.ya?ml$/i.test(filename)) {
					const config = configSchema.parse(yaml(source));
					result.blankIssuesEnabled = config.blank_issues_enabled;
					result.contactLinks = config.contact_links;
				} else if (/\.(md|ya?ml)$/i.test(filename))
					result.issueTemplates.push(issueTemplate(filename, source));
			} catch {
				// GitHub omits invalid templates and ignores invalid chooser config.
			}
		}
		result.issueTemplates.sort(
			(a, b) =>
				Number(a.form === null) - Number(b.form === null) ||
				a.filename.localeCompare(b.filename),
		);
		// The default template is first; directory templates remain individually selectable.
		for (const [index, entries] of dirs.entries()) {
			const defaultFile = entries.find(isDefault);
			if (
				defaultFile &&
				!result.pullRequestTemplates.some(
					(item) =>
						!item.filename.toLowerCase().includes("pull_request_template/"),
				) &&
				withinFileLimit()
			) {
				const body = await read(defaultFile);
				if (body !== undefined)
					result.pullRequestTemplates.unshift({
						filename: defaultFile.path,
						body,
					});
			}
			for (const entry of prFolders[index] ?? []) {
				if (withinFileLimit()) {
					const body = await read(entry);
					if (body !== undefined)
						result.pullRequestTemplates.push({ filename: entry.path, body });
				}
			}
		}
		return result;
	});
}
