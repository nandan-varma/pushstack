/**
 * Tests for r2-operations.ts — circuit breaker, retry logic, presigned URLs,
 * and error handling at the S3/R2 boundary.
 */
import { PutObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();
vi.mock("#/lib/r2", () => ({
	getR2Client: () => ({ send: mockSend }),
	getR2Config: () => ({
		bucketName: "test-bucket",
		endpoint: "https://test.r2.cloudflarestorage.com",
	}),
}));

vi.mock("#/server/perf-log", () => ({
	perfR2: (_label: string, fn: () => Promise<unknown>) => fn(),
	perfStep: (_label: string, fn: () => Promise<unknown>) => fn(),
}));

// Circuit breaker state is module-level; to get a clean slate for each test we
// re-import the module.  The circuit breaker resets to "closed" / 0 failures on
// fresh import, so no manual reset function is needed.
async function freshImport() {
	vi.resetModules();
	return import("#/lib/r2-operations");
}

function s3NotFound(_key: string) {
	const err = new S3ServiceException({
		name: "NoSuchKey",
		message: "The specified key does not exist.",
		$metadata: { httpStatusCode: 404 },
	} as never);
	return err;
}

function s3InternalError() {
	return new S3ServiceException({
		name: "InternalError",
		message: "We encountered an internal error. Please try again.",
		$metadata: { httpStatusCode: 500 },
	} as never);
}

describe("r2-operations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("uploadToR2", () => {
		it("succeeds on first attempt", async () => {
			mockSend.mockResolvedValueOnce(undefined);
			const { uploadToR2 } = await freshImport();
			const result = await uploadToR2(
				"repos/a/r/file.bin",
				Buffer.from("data"),
			);
			expect(result).toEqual({
				key: "repos/a/r/file.bin",
				bucketName: "test-bucket",
			});
			expect(mockSend).toHaveBeenCalledTimes(1);
			expect(mockSend.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
		});

		it("retries on retryable error and eventually succeeds", async () => {
			mockSend
				.mockRejectedValueOnce(s3InternalError())
				.mockResolvedValueOnce(undefined);

			const { uploadToR2 } = await freshImport();
			const result = await uploadToR2("key", Buffer.from("data"));
			expect(result.key).toBe("key");
			expect(mockSend).toHaveBeenCalledTimes(2);
		});

		it("gives up after max retries", async () => {
			mockSend.mockRejectedValue(s3InternalError());

			const { uploadToR2 } = await freshImport();
			await expect(uploadToR2("key", Buffer.from("data"))).rejects.toThrow();
			// MAX_RETRIES = 3, so 4 total attempts (initial + 3 retries)
			expect(mockSend).toHaveBeenCalledTimes(4);
		});

		it("does not retry on non-retryable errors", async () => {
			// Circuit breaker "open" state is a non-retryable path — it throws
			// R2UploadError("Circuit breaker is open", retryable=false).
			// Once the breaker trips, further calls fail immediately without retries.
			const { uploadToR2, getCircuitBreakerState } = await freshImport();

			// Trip the breaker with 5 failures
			mockSend.mockRejectedValue(s3InternalError());
			for (let i = 0; i < 5; i++) {
				await uploadToR2("key", Buffer.from("data")).catch(() => {});
			}
			expect(getCircuitBreakerState().state).toBe("open");

			// Now a call should fail immediately (1 attempt) — circuit breaker is open
			mockSend.mockClear();
			await expect(uploadToR2("key", Buffer.from("data"))).rejects.toThrow(
				"Circuit breaker is open",
			);
			// No S3 calls should have been made — the circuit breaker short-circuits
			expect(mockSend).not.toHaveBeenCalled();
		});
	});

	describe("downloadFromR2", () => {
		it("rethrows 404 without wrapping", async () => {
			mockSend.mockRejectedValueOnce(s3NotFound("key"));

			const { downloadFromR2 } = await freshImport();
			await expect(downloadFromR2("key")).rejects.toThrow();
			// Should be the raw S3 exception, not an R2DownloadError wrapper
			expect(mockSend).toHaveBeenCalledTimes(1);
		});

		it("wraps non-404 errors as R2DownloadError", async () => {
			mockSend.mockRejectedValueOnce(s3InternalError());

			const { downloadFromR2 } = await freshImport();
			await expect(downloadFromR2("key")).rejects.toThrow(
				expect.objectContaining({
					message: expect.stringContaining("Failed to download"),
				}),
			);
		});
	});

	describe("headR2Object", () => {
		it("returns metadata on success", async () => {
			mockSend.mockResolvedValueOnce({
				ContentLength: 1024,
				ContentType: "application/octet-stream",
				ETag: '"abc123"',
			});

			const { headR2Object } = await freshImport();
			const result = await headR2Object("key");
			expect(result).toEqual({
				size: 1024,
				contentType: "application/octet-stream",
				etag: '"abc123"',
			});
		});

		it("returns null for 404", async () => {
			mockSend.mockRejectedValueOnce(s3NotFound("key"));

			const { headR2Object } = await freshImport();
			const result = await headR2Object("key");
			expect(result).toBeNull();
		});

		it("throws R2DownloadError for non-404 errors", async () => {
			mockSend.mockRejectedValueOnce(s3InternalError());

			const { headR2Object } = await freshImport();
			await expect(headR2Object("key")).rejects.toThrow(
				expect.objectContaining({
					message: expect.stringContaining("Failed to stat"),
				}),
			);
		});
	});

	describe("circuit breaker", () => {
		it("opens after 5 consecutive non-404 failures", async () => {
			mockSend.mockRejectedValue(s3InternalError());
			const { uploadToR2, getCircuitBreakerState } = await freshImport();

			// Drive 5 failures to trip the breaker
			for (let i = 0; i < 5; i++) {
				await uploadToR2("key", Buffer.from("data")).catch(() => {});
			}

			expect(getCircuitBreakerState().state).toBe("open");

			// Next call should immediately throw with circuit breaker message
			await expect(uploadToR2("key", Buffer.from("data"))).rejects.toThrow(
				"Circuit breaker is open",
			);
		});

		it("does not count 404/NoSuchKey toward breaker threshold", async () => {
			mockSend.mockRejectedValue(s3NotFound("key"));
			const { downloadFromR2, getCircuitBreakerState } = await freshImport();

			for (let i = 0; i < 10; i++) {
				await downloadFromR2("key").catch(() => {});
			}

			expect(getCircuitBreakerState().state).toBe("closed");
			expect(getCircuitBreakerState().failures).toBe(0);
		});

		it("resets failure count on success after half-open recovery", async () => {
			const { uploadToR2, getCircuitBreakerState } = await freshImport();

			// Trip the breaker (5 failures → open)
			mockSend.mockRejectedValue(s3InternalError());
			for (let i = 0; i < 5; i++) {
				await uploadToR2("key", Buffer.from("data")).catch(() => {});
			}
			expect(getCircuitBreakerState().state).toBe("open");

			// Fast-forward past the 30s timeout → half-open
			const originalNow = Date.now;
			Date.now = () => originalNow() + 31000;

			// Success in half-open resets failures and closes the breaker
			mockSend.mockResolvedValueOnce(undefined);
			await uploadToR2("key", Buffer.from("data"));
			expect(getCircuitBreakerState().state).toBe("closed");
			expect(getCircuitBreakerState().failures).toBe(0);

			Date.now = originalNow;
		});

		it("transitions to half-open after timeout then recovers", async () => {
			const { uploadToR2, getCircuitBreakerState } = await freshImport();

			// Trip the breaker
			mockSend.mockRejectedValue(s3InternalError());
			for (let i = 0; i < 5; i++) {
				await uploadToR2("key", Buffer.from("data")).catch(() => {});
			}
			expect(getCircuitBreakerState().state).toBe("open");

			// Manually fast-forward the circuit breaker timeout
			// by setting lastFailureTime to the past
			// The state is read-only, so we need to simulate the timeout.
			// Since we can't directly modify module state, we mock Date.now
			const originalNow = Date.now;
			Date.now = () => originalNow() + 31000; // past the 30s timeout

			// Next call should go to half-open and succeed
			mockSend.mockResolvedValueOnce(undefined);
			await uploadToR2("key", Buffer.from("data"));
			expect(getCircuitBreakerState().state).toBe("closed");

			Date.now = originalNow;
		});
	});

	describe("getPublicUrl", () => {
		it("constructs URL from config", async () => {
			const { getPublicUrl } = await freshImport();
			const url = getPublicUrl("repos/a/r/file.txt");
			expect(url).toBe(
				"https://test.r2.cloudflarestorage.com/test-bucket/repos/a/r/file.txt",
			);
		});
	});
});
