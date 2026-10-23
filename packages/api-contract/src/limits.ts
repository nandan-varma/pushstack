/**
 * The input bounds the API enforces. They mirror `apps/web/src/lib/limits.ts`
 * (which will import them from here once the web side adopts the contract).
 */
export const DEFAULT_PER_PAGE = 30;
export const MAX_PER_PAGE = 100;
export const MAX_THREAD_TITLE_CHARS = 256;
export const MAX_BODY_CHARS = 65_536;
/** A commit comment's `path`. */
export const MAX_COMMENT_PATH_CHARS = 4096;
export const MAX_COMMIT_MESSAGE_CHARS = 10_000;
/** A commit status's `context`. */
export const MAX_STATUS_CONTEXT_CHARS = 255;
/** A commit status's `description`. */
export const MAX_STATUS_DESCRIPTION_CHARS = 140;
/** A status `target_url` or check run `details_url`. */
export const MAX_REPORT_URL_CHARS = 2048;
/** A check run's `name` and `external_id`. */
export const MAX_CHECK_NAME_CHARS = 255;
/** A check run output's `title`. */
export const MAX_CHECK_TITLE_CHARS = 255;
/** A check run output's `summary` and `text` (GitHub: 65535 characters). */
export const MAX_CHECK_OUTPUT_CHARS = 65_535;
/** Statuses for one commit and context (GitHub: 1000). */
export const MAX_STATUSES_PER_CONTEXT = 1000;
/** Check runs for one commit. */
export const MAX_CHECK_RUNS_PER_COMMIT = 1000;
export const MAX_LABEL_NAME_CHARS = 50;
export const MAX_LABEL_DESCRIPTION_CHARS = 100;
export const MAX_LABELS_PER_THREAD = 100;
export const MAX_MILESTONE_TITLE_CHARS = 256;
export const MAX_MILESTONE_DESCRIPTION_CHARS = 65_536;
export const MAX_ASSIGNEES = 10;
export const MAX_REPO_DESCRIPTION_CHARS = 500;
export const MAX_STORAGE_NAME_LENGTH = 100;

/** Usernames and repository names; keeps `/` and `..` out of storage keys. */
export const STORAGE_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
