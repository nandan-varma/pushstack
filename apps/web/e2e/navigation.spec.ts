import { expect, test } from "@playwright/test";

test.describe("Route Navigation E2E", () => {
	for (const path of [
		"/users/alice",
		"/repo/alice/proj",
		"/repo/%2F%2Fevil.com",
		"/repo/%5Cevil.com",
		"/repo",
		"/users",
	]) {
		test(`obsolete web path ${path} returns 404 without redirecting`, async ({
			request,
		}) => {
			const response = await request.get(path, { maxRedirects: 0 });
			expect(response.status()).toBe(404);
			expect(response.headers().location).toBeUndefined();
		});
	}

	test("home page renders hero content", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("h1")).toContainText(
			"A new home for your code. Keep the way you work.",
		);
	});

	test("navigating to login via the Sign in link shows login form", async ({
		page,
	}) => {
		await page.goto("/");
		await page.getByRole("link", { name: "Sign in" }).click();
		await expect(page).toHaveURL("/login");
		await expect(page.locator("h1")).toContainText("Welcome back");
	});

	test("Get started leads to sign-up", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("link", { name: "Get started" }).first().click();
		await expect(page).toHaveURL("/signup");
	});

	test("repositories redirects to login when not authenticated", async ({
		page,
	}) => {
		await page.goto("/repositories");
		await expect(page).toHaveURL("/login");
	});

	test("back button restores previous page content", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("h1")).toContainText("A new home for your code.");

		await page.getByRole("link", { name: "Sign in" }).click();
		await expect(page).toHaveURL("/login");

		await page.goBack();
		await expect(page).toHaveURL("/");
		await expect(page.locator("h1")).toContainText("A new home for your code.");
	});

	test("about page renders via direct navigation", async ({ page }) => {
		await page.goto("/about");
		await expect(page).toHaveURL("/about");
		await expect(page.locator("h1")).toContainText(
			"A fresh start, with familiar ways to work.",
		);
	});

	test("login page renders the sign-in form", async ({ page }) => {
		await page.goto("/login");
		await expect(page.getByLabel("Username")).toBeVisible();
		await expect(page.getByLabel("Password")).toBeVisible();
	});

	test("sign-up link on login page navigates to register", async ({ page }) => {
		await page.goto("/login");
		await page.click("text=Create one");
		await expect(page).toHaveURL("/signup");
	});
});
