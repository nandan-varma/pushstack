/**
 * Reusable input schemas. Query values arrive as strings, so numeric ones
 * coerce (typed as numbers for clients); lenient parameters `.catch` their
 * default as GitHub does, strict ones fail (the server answers 422).
 */
import { z } from "zod";
import {
	DEFAULT_PER_PAGE,
	MAX_ASSIGNEES,
	MAX_BODY_CHARS,
	MAX_LABEL_DESCRIPTION_CHARS,
	MAX_LABEL_NAME_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_MILESTONE_DESCRIPTION_CHARS,
	MAX_MILESTONE_TITLE_CHARS,
	MAX_PER_PAGE,
	MAX_REVIEWERS_PER_REQUEST,
	MAX_STORAGE_NAME_LENGTH,
	MAX_THREAD_TITLE_CHARS,
	STORAGE_NAME_RE,
} from "./limits";

/** The largest id the database's `integer` columns hold. */
const MAX_INT32 = 2_147_483_647;

/**
 * A positive integer path or query value that fits an `integer` column.
 * Strings must be canonical digits: `0x1`, `1e0`, `1.0` and ` 1` are rejected.
 */
// Typed as taking a number: clients pass numbers, servers parse URL strings.
export const positiveInt = z
	.union([z.number(), z.string().regex(/^[1-9]\d{0,9}$/)])
	.pipe(
		z.coerce.number<number>().int().positive().max(MAX_INT32),
	) as unknown as z.ZodType<number, number>;

/** `page` / `per_page`: bad values fall back, `per_page` caps at 100. */
export const pagination = z.object({
	page: positiveInt.optional().catch(undefined),
	per_page: positiveInt
		.optional()
		.catch(undefined)
		.transform((value) => Math.min(value ?? DEFAULT_PER_PAGE, MAX_PER_PAGE)),
});

/** A boolean query flag: `true` is true, anything else (or absence) false; a boolean for clients. */
export const queryBoolean = z
	.union([z.boolean(), z.string()])
	.optional()
	.transform(
		(value) => value === true || value === "true",
	) as unknown as z.ZodType<boolean, boolean | undefined>;

export const direction = z.enum(["asc", "desc"]).optional().catch(undefined);

/** A comma-separated list in the query; an array for clients. */
export const commaList = <T extends z.ZodType<string, string>>(
	item: T,
	max: number,
) =>
	z
		.union([z.array(z.string()), z.string()])
		.transform((value) =>
			(Array.isArray(value) ? value : value.split(","))
				.map((part) => part.trim())
				.filter(Boolean)
				.slice(0, max),
		)
		.pipe(z.array(item));

export const repoParams = z.object({ owner: z.string(), repo: z.string() });
export const issueParams = repoParams.extend({ issue_number: positiveInt });
export const pullParams = repoParams.extend({ pull_number: positiveInt });

export const repoName = z
	.string()
	.max(MAX_STORAGE_NAME_LENGTH)
	.regex(
		STORAGE_NAME_RE,
		"Use letters, numbers, dots, hyphens and underscores, starting and ending with a letter or number",
	);

export const threadTitle = z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS);
export const threadBody = z.string().max(MAX_BODY_CHARS);
export const commentBody = z.string().trim().min(1).max(MAX_BODY_CHARS);

export const labelName = z.string().trim().min(1).max(MAX_LABEL_NAME_CHARS);
/** A 6-digit hex color, with or without `#`; normalized to lowercase without it. */
export const labelColor = z
	.string()
	.trim()
	.regex(/^#?[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex value")
	.transform((value) => value.replace(/^#/, "").toLowerCase());
export const labelDescription = z
	.string()
	.trim()
	.max(MAX_LABEL_DESCRIPTION_CHARS);
export const labelNames = z.array(labelName).max(MAX_LABELS_PER_THREAD);

export const reviewerLogins = z
	.array(z.string().trim().min(1).max(100))
	.max(MAX_REVIEWERS_PER_REQUEST);
export const milestoneTitle = z
	.string()
	.trim()
	.min(1)
	.max(MAX_MILESTONE_TITLE_CHARS);
export const milestoneDescription = z
	.string()
	.max(MAX_MILESTONE_DESCRIPTION_CHARS);
/** A due date, ISO 8601 (`2026-12-31T00:00:00Z`). */
export const milestoneDueOn = z.iso.datetime({ offset: true });
/** A milestone's `number` as an issue body names it: an integer or its string. */
export const milestoneRef = z.union([
	z.number().int().positive(),
	z
		.string()
		.regex(/^[1-9][0-9]{0,9}$/)
		.transform(Number),
]);

/** The deprecated singular `assignee`: one login. */
export const assigneeLogin = z.string().trim().min(1).max(100);
export const assigneeLogins = z
	.array(z.string().trim().min(1).max(100))
	.max(MAX_ASSIGNEES);

/** The message of an {@link unsupported} field's refusal; the server maps it to a 422 error. */
export const UNSUPPORTED_PARAMETER = "is not supported by PushStack";

/**
 * A GitHub query or body field PushStack does not implement. Sending it is a
 * 422 naming the field: a field that is silently dropped looks accepted and
 * changes nothing (a filter that is ignored returns the wrong rows).
 */
export const unsupportedUnless = (accept: (value: unknown) => boolean) =>
	z
		.any()
		.refine(
			(value) => value === undefined || accept(value),
			UNSUPPORTED_PARAMETER,
		)
		.optional();

/** Refused whenever sent. */
export const unsupported = unsupportedUnless(() => false);
