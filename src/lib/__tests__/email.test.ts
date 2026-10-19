import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("resend", () => {
	return {
		Resend: class MockResend {
			emails = { send: mockSend };
		},
	};
});

import { sendEmail } from "../email";

describe("sendEmail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("RESEND_API_KEY", "re_test");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("prints the email's links instead of sending when no API key is set outside production", async () => {
		vi.stubEnv("RESEND_API_KEY", "");
		const info = vi.spyOn(console, "info").mockImplementation(() => {});

		await sendEmail({
			to: "user@example.com",
			subject: "Verify",
			html: '<a href="http://localhost:3000/verify?token=a&amp;next=%2F">here</a>',
		});

		expect(mockSend).not.toHaveBeenCalled();
		expect(info.mock.calls[0][0]).toContain(
			"http://localhost:3000/verify?token=a&next=%2F",
		);
	});

	it("refuses to drop email in production without an API key", async () => {
		vi.stubEnv("RESEND_API_KEY", "");
		vi.stubEnv("NODE_ENV", "production");

		await expect(
			sendEmail({ to: "user@example.com", subject: "x", html: "" }),
		).rejects.toThrow("RESEND_API_KEY");
	});

	it("calls Resend with correct parameters", async () => {
		mockSend.mockResolvedValue({ data: { id: "1" }, error: null });

		await sendEmail({
			to: "user@example.com",
			subject: "Test",
			html: "<p>Hello</p>",
		});

		expect(mockSend).toHaveBeenCalledWith({
			from: "pushstack@nandanvarma.com",
			to: "user@example.com",
			subject: "Test",
			html: "<p>Hello</p>",
		});
	});

	it("uses the configured FROM address", async () => {
		mockSend.mockResolvedValue({ data: { id: "1" }, error: null });

		await sendEmail({
			to: "recipient@test.com",
			subject: "Hello",
			html: "<p>World</p>",
		});

		const call = mockSend.mock.calls[0][0];
		expect(call.from).toBeTruthy();
		expect(typeof call.from).toBe("string");
	});

	it("throws on Resend error", async () => {
		mockSend.mockResolvedValue({
			data: null,
			error: { message: "rate limited" },
		});

		await expect(
			sendEmail({
				to: "user@example.com",
				subject: "Test",
				html: "<p>Hello</p>",
			}),
		).rejects.toThrow("Failed to send email: rate limited");
	});

	it("throws on network error", async () => {
		mockSend.mockRejectedValue(new Error("network timeout"));

		await expect(
			sendEmail({
				to: "user@example.com",
				subject: "Test",
				html: "<p>Hello</p>",
			}),
		).rejects.toThrow("network timeout");
	});
});
