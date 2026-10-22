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
			"Good code starts with a clear space.",
		);
	});

	test("navigating to login via Sign In link shows login form", async ({
		page,
	}) => {
		await page.goto("/");
		await page.click("text=Sign In");
		await expect(page).toHaveURL("/auth/login");
		await expect(page.locator("h1")).toContainText("Welcome back");
	});

	test("navigating to login via Dashboard link shows login form", async ({
		page,
	}) => {
		await page.goto("/");
		await page.click("text=Dashboard");
		await expect(page).toHaveURL("/auth/login");
		await expect(page.locator("h1")).toContainText("Welcome back");
	});

	test("repositories link redirects to login when not authenticated", async ({
		page,
	}) => {
		await page.goto("/");
		await page.click("text=Repositories");
		await expect(page).toHaveURL("/auth/login");
	});

	test("back button restores previous page content", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("h1")).toContainText("Good code starts");

		await page.click("text=Sign In");
		await expect(page).toHaveURL("/auth/login");

		await page.goBack();
		await expect(page).toHaveURL("/");
		await expect(page.locator("h1")).toContainText("Good code starts");
	});

	test("about page renders via direct navigation", async ({ page }) => {
		await page.goto("/about");
		await expect(page).toHaveURL("/about");
		await expect(page.locator("h1")).toContainText(
			"Modern code hosting, simplified.",
		);
	});

	test("login page renders the sign-in form", async ({ page }) => {
		await page.goto("/auth/login");
		await expect(page.getByLabel("Username")).toBeVisible();
		await expect(page.getByLabel("Password")).toBeVisible();
	});

	test("sign-up link on login page navigates to register", async ({ page }) => {
		await page.goto("/auth/login");
		await page.click("text=Create one");
		await expect(page).toHaveURL("/auth/register");
	});
});
