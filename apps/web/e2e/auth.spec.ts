import { expect, test } from "@playwright/test";
import {
	dbClient,
	deleteTestUser,
	gotoAndWaitForHydration,
	verifyUserEmail,
} from "./helpers";

const timestamp = Date.now();
const testUser = {
	name: `Test User`,
	username: `testuser${timestamp}`,
	email: `pushstack.test.${timestamp}@gmail.com`,
	password: "SecurePassword123!",
	invalidPassword: "WrongPassword123!",
};

test.describe("Authentication Flow E2E", () => {
	test.describe("Protected Routes", () => {
		test("should redirect to login when accessing protected routes", async ({
			page,
		}) => {
			await page.goto("/dashboard");

			await expect(page).toHaveURL(/\/auth\/login/);
			await expect(page.locator("h1")).toContainText("Welcome back");
		});

		test("should redirect to login when accessing repositories", async ({
			page,
		}) => {
			await page.goto("/repositories");
			await expect(page).toHaveURL(/\/auth\/login/);
		});
	});

	test.describe("Form Validation", () => {
		test("should show registration form with all fields", async ({ page }) => {
			await page.goto("/signup");

			await expect(page.locator("h1")).toContainText("Create your account");
			await expect(page.locator("input#name")).toBeVisible();
			await expect(page.locator("input#username")).toBeVisible();
			await expect(page.locator("input#email")).toBeVisible();
			await expect(page.locator("input#password")).toBeVisible();
			await expect(page.locator("input#confirmPassword")).toBeVisible();
			await expect(page.locator('button[type="submit"]')).toBeVisible();
		});

		test("should show all login form elements", async ({ page }) => {
			await page.goto("/login");

			await expect(page.locator("h1")).toContainText("Welcome back");
			await expect(page.locator("input#identifier")).toBeVisible();
			await expect(page.locator("input#password")).toBeVisible();
			await expect(page.locator('button[type="submit"]')).toBeVisible();
			await expect(page.locator("text=/forgot password/i")).toBeVisible();
			await expect(page.locator("text=/create one/i")).toBeVisible();
		});

		test("should reject invalid credentials", async ({ page }) => {
			await gotoAndWaitForHydration(page, "/login");

			const invalidEmail = `nonexistent${Date.now()}@testmail.com`;
			await page.locator("input#identifier").fill(invalidEmail);
			await page.locator("input#password").fill("wrongpassword123");

			await page.click('button[type="submit"]');

			await expect(page).toHaveURL(/\/auth\/login/, { timeout: 5000 });
		});
	});

	// Serial execution ensures user exists before login/logout tests
	test.describe
		.serial("Full Auth Flow", () => {
			test.afterAll(async () => {
				await deleteTestUser(testUser.email);
			});

			test("should successfully register a new user", async ({ page }) => {
				await gotoAndWaitForHydration(page, "/signup");

				await page.locator("input#name").fill(testUser.name);
				await page.locator("input#username").fill(testUser.username);
				await page.locator("input#email").fill(testUser.email);
				await page.locator("input#password").fill(testUser.password);
				await page.locator("input#confirmPassword").fill(testUser.password);

				// Submit the form. The app requires email verification before a
				// session exists, so signUp does not log the user in — it stays on
				// /signup and swaps in a "Check your email" confirmation panel
				// (see RegisterPage's verificationEmail state) rather than navigating
				// anywhere.
				await page.click('button[type="submit"]');
				await expect(page.locator("h1")).toContainText("Check your email", {
					timeout: 15000,
				});
				await expect(page.getByText(testUser.email)).toBeVisible();

				const sql = dbClient();
				const rows =
					await sql`SELECT email FROM "user" WHERE email = ${testUser.email}`;
				expect(rows).toHaveLength(1);

				await verifyUserEmail(testUser.email);
			});

			// Login once and exercise persistence + logout in a single continuous
			// session — better-auth's rate limiter (20 req/60s, see src/lib/auth.ts)
			// counts every sign-in POST *and* every get-session GET the header fires
			// on each navigation, so re-logging-in via the UI per assertion trips it.
			test("should login, persist session across reload, and log out", async ({
				page,
			}) => {
				await gotoAndWaitForHydration(page, "/login");
				await page.locator("input#identifier").fill(testUser.email);
				await page.locator("input#password").fill(testUser.password);

				await Promise.all([
					page.waitForURL("/dashboard", { timeout: 15000 }),
					page.click('button[type="submit"]'),
				]);

				await expect(
					page.locator('button[aria-label="Account menu"]'),
				).toBeVisible();

				await page.reload();
				await expect(page).toHaveURL("/dashboard");
				await expect(
					page.locator('button[aria-label="Account menu"]'),
				).toBeVisible();

				await page.click('button[aria-label="Account menu"]');
				await page.click('[role="menuitem"]:has-text("Sign out")');
				await page.waitForURL("/", { timeout: 10000 });
				await expect(page.locator('a:has-text("Sign in")')).toBeVisible();

				await page.goto("/dashboard");
				await expect(page).toHaveURL(/\/auth\/login/);
			});
		});

	test.describe("Password Reset Flow", () => {
		test("should show forgot password form", async ({ page }) => {
			await page.goto("/password_reset");

			await expect(page.locator("h1")).toContainText(/reset.*password/i);
			await expect(page.locator('input[type="email"]')).toBeVisible();
			await expect(page.locator('button[type="submit"]')).toBeVisible();
		});

		test("should navigate to forgot password from login", async ({ page }) => {
			await page.goto("/login");

			await page.click("text=/forgot password/i");

			await expect(page).toHaveURL("/password_reset");
			await expect(page.locator("h1")).toContainText(/reset.*password/i);
		});
	});

	test.describe("Navigation Between Auth Pages", () => {
		test("should navigate from login to registration", async ({ page }) => {
			await page.goto("/login");

			await page.click("text=/create one/i");

			await expect(page).toHaveURL("/signup");
			await expect(page.locator("h1")).toContainText("Create your account");
		});

		test("should navigate from registration to login", async ({ page }) => {
			await page.goto("/signup");

			await page.click('a:has-text("Sign in")');

			await expect(page).toHaveURL("/login");
			await expect(page.locator("h1")).toContainText("Welcome back");
		});
	});
});
