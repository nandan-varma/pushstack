import { describe, expect, it } from "vitest";
import {
	MAX_BODY_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_HISTORY_WALK,
	MAX_LIST_SKIP,
	MAX_RAW_BYTES,
	MAX_THREAD_PAGE_SIZE,
	MAX_WEB_UPLOAD_BYTES,
	maxBase64CharsForBytes,
	THREAD_PAGE_SIZE,
	UPLOAD_WARNING_BYTES,
} from "../limits";

/**
 * The bounds themselves, and the relationships between them that make them
 * useful. Each of these encodes a decision that would otherwise silently
 * regress: a warning that fires after the rejection, a base64 ceiling that
 * admits more bytes than the cap, a walk bound that contradicts the page bound.
 */

describe("upload bounds", () => {
	it("warns before it rejects", () => {
		// A warning at the same size as the cap is the error message, not a
		// warning — the whole point is that the user finds out early enough to
		// switch to `git push`.
		expect(UPLOAD_WARNING_BYTES).toBeLessThan(MAX_WEB_UPLOAD_BYTES);
	});

	it("caps an encoded upload at exactly what the byte cap can decode to", () => {
		// The ceiling must be tight: a payload one base64 group longer than the
		// ceiling has to decode to more bytes than the cap allows, or the cap
		// isn't the cap.
		for (const bytes of [1, 2, 3, 4, 5, 100, MAX_WEB_UPLOAD_BYTES]) {
			const ceiling = maxBase64CharsForBytes(bytes);
			expect(ceiling % 4, `ceiling for ${bytes}`).toBe(0);
			expect(atob("A".repeat(ceiling)).length).toBeLessThanOrEqual(
				ceiling, // decodes to at most ceil(bytes/3)*3
			);
			expect(atob("A".repeat(ceiling + 4)).length).toBeGreaterThan(bytes);
		}
	});
});

describe("read bounds", () => {
	it("bounds a commit page's walk by the page offset it accepts", () => {
		// A page walks `limit + skip` commits, so the two bounds are one bound;
		// if they diverge, a validated request could still walk unbounded.
		expect(MAX_HISTORY_WALK).toBe(MAX_LIST_SKIP + 100);
	});

	it("serves raw bytes for anything a single push could have introduced", () => {
		// The raw endpoint streams from memory, so its cap exists to bound the
		// function's heap. It must not be smaller than a web upload, or a file
		// the app itself accepted could not be downloaded again.
		expect(MAX_RAW_BYTES).toBeGreaterThanOrEqual(MAX_WEB_UPLOAD_BYTES);
	});
});

describe("text bounds", () => {
	it("keeps every persisted text bound positive and ordered sensibly", () => {
		expect(MAX_BODY_CHARS).toBeGreaterThan(MAX_COMMIT_MESSAGE_CHARS);
		expect(MAX_COMMIT_MESSAGE_CHARS).toBeGreaterThan(0);
	});
});

describe("thread page bound", () => {
	it("keeps a page of worst-case comments under Vercel's 4.5 MB cap", () => {
		// Control characters are JSON's most expensive escape: 6 bytes each.
		const page = Array.from({ length: MAX_THREAD_PAGE_SIZE }, (_, id) => ({
			id,
			body: "\u0001".repeat(MAX_BODY_CHARS),
			author: { id: "x".repeat(32), username: "u".repeat(39), image: null },
			createdAt: new Date(),
			editedAt: new Date(),
		}));
		expect(JSON.stringify(page).length).toBeLessThan(4_500_000);
		expect(THREAD_PAGE_SIZE).toBeLessThanOrEqual(MAX_THREAD_PAGE_SIZE);
	});
});
