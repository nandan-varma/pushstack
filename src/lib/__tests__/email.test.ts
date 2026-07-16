import { beforeEach, describe, expect, it, vi } from "vitest";

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
