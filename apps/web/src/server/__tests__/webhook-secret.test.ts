/**
 * @vitest-environment node
 *
 * Webhook secrets at rest: sealed with AES-256-GCM, so the row never holds
 * the plaintext and only the derived key opens it.
 */
import { describe, expect, it } from "vitest";
import { openWebhookSecret, sealWebhookSecret } from "../webhook-secret";

describe("webhook secret sealing", () => {
	it("round-trips the secret", () => {
		const sealed = sealWebhookSecret("s3cret");
		expect(sealed).not.toContain("s3cret");
		expect(openWebhookSecret(sealed)).toBe("s3cret");
	});

	it("uses a fresh iv per seal", () => {
		expect(sealWebhookSecret("s3cret")).not.toBe(sealWebhookSecret("s3cret"));
	});

	it("refuses a tampered seal", () => {
		const bytes = Buffer.from(sealWebhookSecret("s3cret"), "base64");
		bytes[bytes.length - 1] ^= 0xff;
		expect(() => openWebhookSecret(bytes.toString("base64"))).toThrow();
	});
});
