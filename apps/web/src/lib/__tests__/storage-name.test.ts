import { describe, expect, it } from "vitest";
import {
	MAX_STORAGE_NAME_LENGTH,
	MAX_USERNAME_LENGTH,
	STORAGE_NAME_PATTERN,
	STORAGE_NAME_RE,
} from "../storage-name";

/**
 * The name rule is a security boundary (the value becomes a storage-key
 * segment), and it is enforced in two places that must agree: the server's zod
 * schemas, and the `pattern` attribute on the sign-up and create-repository
 * forms. These tests hold the derived pattern to the regex, and the regex to
 * the rule — a form that accepts what the server rejects makes the user
 * discover the rule from an error message.
 */

/**
 * How a browser reads an HTML `pattern` attribute: compiled with the `v` flag
 * and anchored implicitly, so the whole value must match.
 */
const asHtmlPattern = (value: string) =>
	new RegExp(`^(?:${STORAGE_NAME_PATTERN})$`).test(value);

const ACCEPTED = [
	"a",
	"A1",
	"my.repo",
	"my-awesome-project",
	"my_repo",
	"a.b-c_d9",
	"9lives",
	"x".repeat(MAX_STORAGE_NAME_LENGTH),
];

const REJECTED = [
	"",
	".",
	"..",
	"...",
	".hidden",
	"trailing.",
	"-leading",
	"trailing-",
	"_leading",
	"trailing_",
	"a/b",
	"a\\b",
	"../etc/passwd",
	"a b",
	"a\tb",
	"café",
];

describe("the storage-name rule", () => {
	it("accepts single safe segments", () => {
		for (const name of ACCEPTED) {
			expect(STORAGE_NAME_RE.test(name), name).toBe(true);
		}
	});

	it("rejects separators, dot-only names and anything not alphanumeric-terminated", () => {
		for (const name of REJECTED) {
			expect(STORAGE_NAME_RE.test(name), name).toBe(false);
		}
	});

	it("accepts consecutive dots, because they cannot form a path segment", () => {
		// The rule forbids separators and a whole-name `.`/`..`, not dots in
		// general: `a..b` is one key segment, and `gitFs` only resolves a segment
		// that is exactly `..`, so it addresses nothing but itself.
		for (const name of ["a..b", "a...b", "valid..name", "a.b.c"]) {
			expect(STORAGE_NAME_RE.test(name), name).toBe(true);
		}
	});

	it("rejects the shapes that would address another repository's storage", () => {
		// The whole reason the rule exists: these become `repos/{owner}/{name}`
		// segments, and gitFs resolves `..` before mapping a path onto a key.
		for (const name of ["..", "../victim", "a/../../b", "/", "./"]) {
			expect(STORAGE_NAME_RE.test(name), name).toBe(false);
		}
	});
});

describe("STORAGE_NAME_PATTERN", () => {
	it("is the regex without its anchors, so HTML's implicit anchoring is the whole rule", () => {
		expect(STORAGE_NAME_PATTERN).toBe(
			STORAGE_NAME_RE.source.replace(/^\^/, "").replace(/\$$/, ""),
		);
		expect(STORAGE_NAME_PATTERN.startsWith("^")).toBe(false);
		expect(STORAGE_NAME_PATTERN.endsWith("$")).toBe(false);
	});

	it("agrees with the regex on every accepted and rejected name", () => {
		for (const name of [...ACCEPTED, ...REJECTED]) {
			expect(asHtmlPattern(name), name).toBe(STORAGE_NAME_RE.test(name));
		}
	});

	it("still requires a whole-string match, like the regex", () => {
		// HTML anchors implicitly, so a name with a valid core and a bad head or
		// tail must fail in the form exactly as it fails on the server.
		for (const name of [
			"valid/name",
			"-valid",
			"valid.",
			".valid",
			"valid name",
		]) {
			expect(asHtmlPattern(name), name).toBe(false);
			expect(STORAGE_NAME_RE.test(name), name).toBe(false);
		}
	});
});

describe("the shared length caps", () => {
	it("caps repository names at the length the server's schema uses", () => {
		expect(MAX_STORAGE_NAME_LENGTH).toBe(100);
		expect(STORAGE_NAME_RE.test("x".repeat(MAX_STORAGE_NAME_LENGTH))).toBe(
			true,
		);
		expect(STORAGE_NAME_RE.test("x".repeat(MAX_STORAGE_NAME_LENGTH + 1))).toBe(
			true, // the regex has no length rule; the zod `.max()` is what caps it
		);
	});

	it("caps usernames at Better Auth's maxUsernameLength", () => {
		expect(MAX_USERNAME_LENGTH).toBe(30);
	});
});
