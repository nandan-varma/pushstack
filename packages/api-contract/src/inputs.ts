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
	MAX_BRANCH_PROTECTION_PATTERN_CHARS,
	MAX_LABEL_DESCRIPTION_CHARS,
	MAX_LABEL_NAME_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_MILESTONE_DESCRIPTION_CHARS,
	MAX_MILESTONE_TITLE_CHARS,
	MAX_PER_PAGE,
	MAX_REQUIRED_APPROVING_REVIEWS,
	MAX_REQUIRED_STATUS_CONTEXTS,
	MAX_REVIEWERS_PER_REQUEST,
	MAX_STATUS_CONTEXT_CHARS,
	MAX_STORAGE_NAME_LENGTH,
	MAX_THREAD_TITLE_CHARS,
	MAX_WEBHOOK_EVENTS,
	MAX_WEBHOOK_SECRET_CHARS,
	MAX_WEBHOOK_URL_CHARS,
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
/** A branch name may contain `/`, so it is the rest of the path (`{+branch}`). */
export const branchParams = repoParams.extend({ branch: z.string().min(1) });

export const repoName = z
	.string()
	.max(MAX_STORAGE_NAME_LENGTH)
	.regex(
		STORAGE_NAME_RE,
		"Use letters, numbers, dots, hyphens and underscores, starting and ending with a letter or number",
	)
	// `x.wiki` would be ambiguous with the wiki's `/{repo}.wiki.git` clone URL.
	.refine(
		(name) => !name.endsWith(".wiki"),
		"Repository names cannot end with .wiki",
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

/**
 * GitHub's repository webhook events (plus `*`). A name PushStack never emits
 * is still accepted, as on GitHub: a hook subscribed to it simply never fires.
 */
export const WEBHOOK_EVENT_NAMES = [
	"*",
	"branch_protection_configuration",
	"branch_protection_rule",
	"check_run",
	"check_suite",
	"code_scanning_alert",
	"commit_comment",
	"create",
	"custom_property",
	"custom_property_values",
	"delete",
	"dependabot_alert",
	"deploy_key",
	"deployment",
	"deployment_protection_rule",
	"deployment_review",
	"deployment_status",
	"discussion",
	"discussion_comment",
	"fork",
	"github_app_authorization",
	"gollum",
	"installation",
	"installation_repositories",
	"installation_target",
	"issue_comment",
	"issues",
	"label",
	"marketplace_purchase",
	"member",
	"membership",
	"merge_group",
	"merge_queue_entry",
	"milestone",
	"org_block",
	"organization",
	"package",
	"page_build",
	"personal_access_token_request",
	"ping",
	"project",
	"project_card",
	"project_column",
	"projects_v2",
	"projects_v2_item",
	"projects_v2_status_update",
	"public",
	"pull_request",
	"pull_request_review",
	"pull_request_review_comment",
	"pull_request_review_thread",
	"push",
	"registry_package",
	"release",
	"repository",
	"repository_archived",
	"repository_dispatch",
	"repository_edited",
	"repository_import",
	"repository_renamed",
	"repository_ruleset",
	"repository_transferred",
	"repository_unarchived",
	"repository_vulnerability_alert",
	"secret_scanning_alert",
	"secret_scanning_alert_location",
	"secret_scanning_scan",
	"security_advisory",
	"security_and_analysis",
	"sponsorship",
	"star",
	"status",
	"sub_issues",
	"team",
	"team_add",
	"watch",
	"workflow_dispatch",
	"workflow_job",
	"workflow_run",
] as const;

export const webhookEventName = z.enum(WEBHOOK_EVENT_NAMES);
export const webhookEvents = z.array(webhookEventName).max(MAX_WEBHOOK_EVENTS);

/** The URL a hook delivers to; PushStack never delivers in clear text. */
export const webhookUrl = z
	.string()
	.max(MAX_WEBHOOK_URL_CHARS)
	.refine((value) => {
		try {
			return new URL(value).protocol === "https:";
		} catch {
			return false;
		}
	}, "must be an HTTPS URL");

export const webhookSecret = z.string().max(MAX_WEBHOOK_SECRET_CHARS);

/**
 * A hook's `config`. `insecure_ssl: 1` (delivering without certificate
 * verification) is refused, so only `0` is accepted.
 */
export const webhookConfigBody = z.object({
	url: webhookUrl,
	content_type: z.enum(["json", "form"]).optional(),
	secret: webhookSecret.optional(),
	insecure_ssl: unsupportedUnless((value) => value === "0" || value === 0),
});

/** `PATCH …/config`: every setting optional. */
export const webhookConfigPatchBody = webhookConfigBody.partial();

/**
 * The delivery log pages by `cursor` (a delivery id), not by `page`; GitHub
 * returns 422 for a non-numeric cursor or an unknown `status`.
 */
export const webhookDeliveryQuery = z.object({
	per_page: positiveInt
		.optional()
		.catch(undefined)
		.transform((value) => Math.min(value ?? DEFAULT_PER_PAGE, MAX_PER_PAGE)),
	cursor: positiveInt.optional(),
	status: z.enum(["success", "failure"]).optional(),
});

/**
 * A body boolean as GitHub accepts it: `true`/`false`, or the strings a
 * form-encoded client (`gh api -f`) sends for them.
 */
export const booleanBody = z
	.union([z.boolean(), z.enum(["true", "false"])])
	.transform((value) => value === true || value === "true");

/**
 * A branch protection rule's pattern: the branch path of its endpoints, where
 * `*` and `?` are wildcards. `git-ref-name.ts` accepts the ref-shaped rest.
 */
export const branchProtectionPattern = z
	.string()
	.min(1)
	.max(MAX_BRANCH_PROTECTION_PATTERN_CHARS);

/** The status check contexts a rule requires. */
export const branchProtectionContexts = z
	.array(z.string().trim().min(1).max(MAX_STATUS_CONTEXT_CHARS))
	.max(MAX_REQUIRED_STATUS_CONTEXTS);

/** GitHub's `required_approving_review_count`: 0 to 6, above is a 422. */
export const branchProtectionApprovingReviews = z
	.number()
	.int()
	.min(0)
	.max(MAX_REQUIRED_APPROVING_REVIEWS);
