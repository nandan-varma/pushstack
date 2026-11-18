import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	deleteTestUser,
	gotoAndWaitForHydration,
	verifyUserEmail,
} from "./helpers";

const timestamp = Date.now();
const user = {
	name: "Discussion Test User",
	username: `discussionuser${timestamp}`,
	email: `pushstack.discussion.test.${timestamp}@gmail.com`,
	password: "SecurePassword123!",
};
const repo = `discussion-repo-${timestamp}`;

test.describe
	.serial("Discussions E2E", () => {
		let page: Page;

		test.beforeAll(async ({ browser }) => {
			page = await browser.newPage();
		});

		test.afterAll(async () => {
			await page.close();
			await deleteTestUser(user.email);
		});

		test("registers, verifies and signs in", async () => {
			await gotoAndWaitForHydration(page, "/signup");
			await page.locator("input#name").fill(user.name);
			await page.locator("input#username").fill(user.username);
			await page.locator("input#email").fill(user.email);
			await page.locator("input#password").fill(user.password);
			await page.locator("input#confirmPassword").fill(user.password);
			await page.click('button[type="submit"]');
			await expect(page.locator("h1")).toContainText("Check your email", {
				timeout: 15000,
			});
			await verifyUserEmail(user.email);
			await gotoAndWaitForHydration(page, "/login");
			await page.locator("input#identifier").fill(user.email);
			await page.locator("input#password").fill(user.password);
			await page.click('button[type="submit"]');
			await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
		});

		test("creates a repository with an empty forum", async () => {
			await gotoAndWaitForHydration(page, "/new");
			await page.locator("input#name").fill(repo);
			await page.click('button[type="submit"]');
			await expect(page).toHaveURL(new RegExp(`/${user.username}/${repo}`), {
				timeout: 15000,
			});
			await page.goto(`/${user.username}/${repo}/discussions`);
			await expect(page.getByText(/no discussions yet/i)).toBeVisible();
			await expect(page.getByRole("link", { name: /Q&A/ })).toBeVisible();
		});

		test("creates a Q&A discussion, comments, replies and marks the answer", async () => {
			await gotoAndWaitForHydration(
				page,
				`/${user.username}/${repo}/discussions/new`,
			);
			await page.locator("#discussion-title").fill("How does it work?");
			await page.locator("#discussion-body").fill("A question about the app.");
			await page.locator("#discussion-category").click();
			await page.getByRole("option", { name: "Q&A" }).click();
			await page.getByRole("button", { name: "Start discussion" }).click();
			await expect(page).toHaveURL(
				new RegExp(`/${user.username}/${repo}/discussions/1`),
				{ timeout: 15000 },
			);

			await page.getByPlaceholder("Leave a comment").fill("The answer.");
			await page.getByRole("button", { name: "Comment" }).click();
			await expect(page.getByText("The answer.")).toBeVisible({
				timeout: 15000,
			});

			await page.getByRole("button", { name: "Reply" }).first().click();
			await page.getByPlaceholder("Leave a comment").last().fill("A reply.");
			await page.getByRole("button", { name: "Comment" }).last().click();
			await expect(page.getByText("A reply.")).toBeVisible({
				timeout: 15000,
			});

			// A reply's own comment shows no reply button: one level only.
			await expect(page.getByRole("button", { name: "Reply" })).toHaveCount(1);
			await page.getByRole("button", { name: "Mark as answer" }).last().click();
			await expect(page.getByText("Answer", { exact: true })).toBeVisible({
				timeout: 15000,
			});

			await page.goto(`/${user.username}/${repo}/discussions`);
			await expect(page.getByText("Answered")).toBeVisible({
				timeout: 15000,
			});
		});

		test("a signed-out visitor reads but is asked to sign in to post", async ({
			browser,
		}) => {
			const context = await browser.newContext();
			const visitor = await context.newPage();
			const hydrationErrors: string[] = [];
			visitor.on("console", (message) => {
				if (/hydrat/i.test(message.text()))
					hydrationErrors.push(message.text());
			});
			await gotoAndWaitForHydration(
				visitor,
				`/${user.username}/${repo}/discussions/1`,
			);
			await expect(visitor.getByText("How does it work?")).toBeVisible();
			await expect(
				visitor.getByText("Sign in to join this conversation."),
			).toBeVisible();
			await gotoAndWaitForHydration(
				visitor,
				`/${user.username}/${repo}/discussions/1`,
			);
			expect(hydrationErrors).toEqual([]);
			await context.close();
		});
	});
