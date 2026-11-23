import { mkdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api-postgres";
import { drizzle } from "drizzle-orm/pglite";
import * as appSchema from "../src/db/app-schema";
import * as authSchema from "../src/db/schema";

const localDir = process.env.PUSHSTACK_LOCAL_DIR;
const authUrl = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
if (
	!localDir ||
	process.env.NODE_ENV === "production" ||
	process.env.DATABASE_URL ||
	process.env.R2_ENDPOINT ||
	process.env.R2_BUCKET_NAME ||
	process.env.R2_ACCESS_KEY_ID ||
	process.env.R2_SECRET_ACCESS_KEY ||
	authUrl.protocol !== "http:" ||
	!["localhost", "127.0.0.1", "[::1]"].includes(authUrl.hostname)
) {
	throw new Error("Demo data may only be created in an offline local database");
}

// PGlite has one owner at a time: schema setup closes before application helpers
// open their client, and that client closes before the dev server starts.
mkdirSync(localDir, { recursive: true });
const client = new PGlite(path.join(localDir, "db"));
try {
	const { apply, hints } = await pushSchema(
		{ ...authSchema, ...appSchema },
		drizzle({ client }),
	);
	if (hints.length > 0) throw new Error(hints.join("\n"));
	await apply();
} finally {
	await client.close();
}

// Application stores import Vite raw-text templates; the offline setup process
// reads those same files without starting a second Vite server.
const rawTextHooks = registerHooks({
	load(url, context, nextLoad) {
		if (url.startsWith("file:") && new URL(url).search === "?raw") {
			return {
				format: "module",
				shortCircuit: true,
				source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url), "utf8"))}`,
			};
		}
		return nextLoad(url, context);
	},
});

const { db } = await import("../src/db");
try {
	await seedDemo();
} finally {
	await (db as unknown as { $client: PGlite }).$client.close();
	rawTextHooks.deregister();
}

async function seedDemo() {
	const { and, eq } = await import("drizzle-orm");
	const { DEMO_REPO } = await import("../src/lib/site");
	const { user } = authSchema;
	const { issues, discussionCategories, projectV2 } = appSchema;
	const id = "pushstack-local-demo";
	const [existingUser] = await db
		.select()
		.from(user)
		.where(eq(user.username, DEMO_REPO.owner));
	if (existingUser && existingUser.id !== id) {
		throw new Error(
			"The local demo username is already in use; refusing to change it",
		);
	}
	if (!existingUser) {
		await db.insert(user).values({
			id,
			name: "PushStack local demo",
			username: DEMO_REPO.owner,
			displayUsername: DEMO_REPO.owner,
			email: "local-demo@pushstack.invalid",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}
	const { createRepositoryForOwner } = await import(
		"../src/server/repository-create"
	);
	const { findRepositoryByName } = await import(
		"../src/server/repository-lookup"
	);
	let repository = await findRepositoryByName(DEMO_REPO.owner, DEMO_REPO.name);
	if (!repository) {
		await createRepositoryForOwner(
			{
				kind: "user",
				id,
				login: DEMO_REPO.owner,
				name: "PushStack local demo",
				email: "local-demo@pushstack.invalid",
			},
			{
				name: DEMO_REPO.name,
				description: "A local walkthrough of PushStack",
				visibility: "public",
				autoInit: false,
				hasProjects: true,
			},
			[
				{
					path: "README.md",
					content: new TextEncoder().encode(
						"# PushStack local walkthrough\n\nExplore issues, reviews, discussions, projects, and the wiki.\n\nThis is development sample data, separate from the hosted project.\n",
					),
				},
			],
		);
		repository = await findRepositoryByName(DEMO_REPO.owner, DEMO_REPO.name);
	}
	if (!repository || repository.owner.id !== id) {
		throw new Error("The local demo repository belongs to another account");
	}
	const { getBranches, getCommitLog } = await import("../src/server/git-read");
	const { createBranch, createCommit } = await import(
		"../src/server/git-write"
	);
	const author = {
		name: "PushStack local demo",
		email: "local-demo@pushstack.invalid",
	};
	if (
		(await getCommitLog(DEMO_REPO.owner, DEMO_REPO.name, "main", 2)).length < 2
	) {
		await createCommit(DEMO_REPO.owner, DEMO_REPO.name, {
			branch: "main",
			message: "Explain the local development walkthrough",
			files: [
				{
					path: "LOCAL-DEMO.md",
					content:
						"# Local development data\n\nThese repositories and conversations are local fixtures. They never change the hosted project.\n",
				},
			],
			author,
			repository,
			actorId: id,
		});
	}
	const branch = "showcase";
	if (
		!(await getBranches(DEMO_REPO.owner, DEMO_REPO.name)).some(
			(b) => b.name === branch,
		)
	) {
		await createBranch(DEMO_REPO.owner, DEMO_REPO.name, branch, "main");
		await createCommit(DEMO_REPO.owner, DEMO_REPO.name, {
			branch,
			message: "Add a first-contribution guide",
			files: [
				{
					path: "CONTRIBUTING.md",
					content:
						"# Welcome\n\nOpen an issue to talk through an idea, then share a pull request.\n",
				},
			],
			author,
			repository,
			actorId: id,
		});
	}
	const issueTitle = "Try the local contribution workflow";
	let [issue] = await db
		.select()
		.from(issues)
		.where(and(eq(issues.repoId, repository.id), eq(issues.title, issueTitle)));
	if (!issue) {
		const { createIssueForUser } = await import("../src/server/issue-store");
		issue = await createIssueForUser(repository.id, id, {
			title: issueTitle,
			body: "Read the README, compare the showcase branch, and review the first-contribution guide.",
			labels: ["documentation"],
		});
	}
	const pullTitle = "Welcome new contributors";
	if (
		!(
			await db
				.select({ id: issues.id })
				.from(issues)
				.where(
					and(eq(issues.repoId, repository.id), eq(issues.title, pullTitle)),
				)
		).length
	) {
		const { createPullRequest } = await import("../src/server/pull-create");
		await createPullRequest({
			repo: repository,
			userId: id,
			canWrite: true,
			title: pullTitle,
			body: `Add a contribution guide. Related to #${issue.number}.`,
			base: "main",
			head: { branch, owner: null },
		});
	}
	const { listWikiPages, saveWikiPage } = await import(
		"../src/server/wiki-git"
	);
	if (!(await listWikiPages(DEMO_REPO.owner, DEMO_REPO.name)).length) {
		await saveWikiPage(DEMO_REPO.owner, DEMO_REPO.name, {
			page: "Home",
			content:
				"# Welcome to the local wiki\n\nThis is a real Git-backed wiki. Clone it, edit a page, or explore its history.\n",
			author,
		});
	}
	const discussionTitle = "What would make your first contribution easier?";
	if (
		!(
			await db
				.select({ id: issues.id })
				.from(issues)
				.where(
					and(
						eq(issues.repoId, repository.id),
						eq(issues.title, discussionTitle),
					),
				)
		).length
	) {
		const [category] = await db
			.select()
			.from(discussionCategories)
			.where(eq(discussionCategories.repoId, repository.id))
			.limit(1);
		if (!category) throw new Error("The local demo has no discussion category");
		const { createDiscussionForUser } = await import(
			"../src/server/discussion-store"
		);
		await createDiscussionForUser(repository.id, id, {
			title: discussionTitle,
			body: "Use this space to talk through ideas before changing code.",
			categoryId: category.id,
		});
	}
	if (
		!(
			await db
				.select({ id: projectV2.id })
				.from(projectV2)
				.where(eq(projectV2.ownerId, id))
		).length
	) {
		const { createProjectForUser, addProjectItem } = await import(
			"../src/server/project-store"
		);
		const project = await createProjectForUser(id, {
			title: "Local contribution walkthrough",
			public: true,
			shortDescription: "Follow an idea from issue to pull request.",
		});
		await addProjectItem(project.id, id, { issueId: issue.id });
	}
	const packageJson = JSON.parse(
		readFileSync(
			path.resolve(
				import.meta.dirname,
				"../../../packages/git-fs-s3/package.json",
			),
			"utf8",
		),
	) as { version: string };
	const tagName = `git-fs-s3@${packageJson.version}`;
	const { findReleaseByTag } = await import("../src/server/release-store");
	if (!(await findReleaseByTag(repository.id, tagName))) {
		const { createRelease } = await import("../src/server/release-service");
		await createRelease(repository, id, {
			tagName,
			targetCommitish: "main",
			name: `Local walkthrough — git-fs-s3 ${packageJson.version}`,
			body: "A local development fixture using the current source package version. This is not a published package release.",
			draft: false,
			prerelease: false,
			makeLatest: "true",
		});
	}
	const { gists } = appSchema;
	const gistDescription =
		"Local walkthrough: use the GitHub CLI with PushStack";
	if (
		!(
			await db
				.select({ id: gists.id })
				.from(gists)
				.where(
					and(eq(gists.ownerId, id), eq(gists.description, gistDescription)),
				)
		).length
	) {
		const { generateGistId, insertGist } = await import(
			"../src/server/gist-store"
		);
		const { initGistRepo, createGistFiles } = await import(
			"../src/server/gist-git"
		);
		const gistId = generateGistId();
		await initGistRepo(gistId);
		await createGistFiles(
			gistId,
			[
				{
					path: "pushstack-gh.sh",
					content:
						"#!/bin/sh\n# Sign in to the hosted service first; these are real CLI commands.\ngh auth login --hostname git.nandan.fyi\ngh repo view git.nandan.fyi/nandan/pushstack\nGH_HOST=git.nandan.fyi gh issue list --repo nandan/pushstack\n",
				},
			],
			author,
		);
		await insertGist({
			id: gistId,
			ownerId: id,
			description: gistDescription,
			visibility: "public",
		});
	}
	const contributorId = "pushstack-local-contributor";
	const contributorLogin = "contributor";
	const [contributor] = await db
		.select()
		.from(user)
		.where(eq(user.username, contributorLogin));
	if (contributor && contributor.id !== contributorId) {
		throw new Error(
			"The local contributor username is already in use; refusing to change it",
		);
	}
	if (!contributor) {
		await db.insert(user).values({
			id: contributorId,
			username: contributorLogin,
			displayUsername: contributorLogin,
			name: "Local contributor",
			email: "contributor@pushstack.invalid",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}
	if (!(await findRepositoryByName(contributorLogin, DEMO_REPO.name))) {
		const { forkRepositoryForOwner } = await import(
			"../src/server/repository-fork"
		);
		await forkRepositoryForOwner(
			repository,
			{ kind: "user", id: contributorId, login: contributorLogin },
			DEMO_REPO.name,
		);
	}
	console.info(
		`[dev:local] demo ready at /${DEMO_REPO.owner}/${DEMO_REPO.name}`,
	);
}
