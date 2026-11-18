/**
 * The input bounds the API enforces: the single source. `apps/web/src/lib/limits.ts`
 * re-exports them, so a new API-facing cap is added here and nowhere else.
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
export const MAX_RELEASE_NAME_CHARS = 256;
export const MAX_RELEASE_TAG_CHARS = 255;

/**
 * Repository webhooks: hooks one event type may have in a repository
 * (GitHub's own cap), events one hook may subscribe to, and the length of a
 * hook's URL and secret.
 */
export const MAX_HOOKS_PER_EVENT = 20;
export const MAX_WEBHOOK_EVENTS = 30;
export const MAX_WEBHOOK_URL_CHARS = 2048;
export const MAX_WEBHOOK_SECRET_CHARS = 256;

export const MAX_RELEASE_ASSET_NAME_CHARS = 255;
export const MAX_RELEASE_ASSET_LABEL_CHARS = 255;
export const MAX_RELEASE_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
/** GitHub: at most 15 users and 15 teams per request-reviewers call. */
export const MAX_REVIEWERS_PER_REQUEST = 15;
export const MAX_REPO_DESCRIPTION_CHARS = 500;
export const MAX_REPO_HOMEPAGE_CHARS = 255;
export const MAX_REPO_TOPICS = 20;
export const MAX_REPO_TOPIC_CHARS = 50;
export const MAX_STORAGE_NAME_LENGTH = 100;

/** A user's signing keys: one armored OpenPGP key, one SSH public-key line. */
export const MAX_GPG_KEY_CHARS = 65_536;
export const MAX_SSH_SIGNING_KEY_CHARS = 2048;
export const MAX_SIGNING_KEY_TITLE_CHARS = 100;

/** Usernames and repository names; keeps `/` and `..` out of storage keys. */
export const STORAGE_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Gists. GitHub truncates a gist's files map past 300, so creation past this
 * cap is refused (422) instead: every gist's view is then complete.
 */
export const MAX_GIST_FILES = 300;
/** A gist file name is a git tree path, so it gets a path segment's bound. */
export const MAX_GIST_FILE_NAME_CHARS = 255;
/** GitHub documents no bound on a description; this bounds the persisted string. */
export const MAX_GIST_DESCRIPTION_CHARS = 1000;
/** GitHub's `Gist Comment.body` maxLength. */
export const MAX_GIST_COMMENT_BODY_CHARS = 65_535;

/** GitHub's search query cap (`q`); the web app imports it from here. */
export const MAX_SEARCH_QUERY_CHARS = 256;

/**
 * Projects v2: per-owner projects, per-project items and fields, and the
 * strings a caller controls. GitHub's own caps where it publishes one; the
 * rest bound a persisted string or a per-project collection.
 */
export const MAX_PROJECTS_PER_USER = 100;
export const MAX_PROJECT_ITEMS = 10_000;
export const MAX_PROJECT_FIELDS = 50;
export const MAX_PROJECT_SINGLE_SELECT_OPTIONS = 50;
export const MAX_PROJECT_TITLE_CHARS = 256;
export const MAX_PROJECT_DESCRIPTION_CHARS = 500;
export const MAX_PROJECT_FIELD_NAME_CHARS = 50;
export const MAX_PROJECT_OPTION_NAME_CHARS = 50;
export const MAX_PROJECT_TEXT_VALUE_CHARS = 1024;
/** A project or item search query, and the web view's filter string. */
export const MAX_PROJECT_FILTER_CHARS = 500;
