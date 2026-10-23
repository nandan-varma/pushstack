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
export const MAX_LABEL_NAME_CHARS = 50;
export const MAX_LABEL_DESCRIPTION_CHARS = 100;
export const MAX_LABELS_PER_THREAD = 100;
export const MAX_ASSIGNEES = 10;
export const MAX_REPO_DESCRIPTION_CHARS = 500;
export const MAX_REPO_HOMEPAGE_CHARS = 255;
export const MAX_REPO_TOPICS = 20;
export const MAX_REPO_TOPIC_CHARS = 50;
export const MAX_STORAGE_NAME_LENGTH = 100;

/** Usernames and repository names; keeps `/` and `..` out of storage keys. */
export const STORAGE_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
