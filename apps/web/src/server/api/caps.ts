/**
 * The REST API's response-size caps, in one object so behavior tests can
 * lower them (and restore them) instead of building huge fixtures. Responses
 * are buffered, and Vercel caps a buffered response at 4.5 MB.
 */
export const DEFAULT_API_CAPS = {
	/** Contents: files over this are `content: ""`, `encoding: "none"` (GitHub: 1 MB). */
	contentsInlineBytes: 1024 * 1024,
	/** Contents: a directory lists at most this many entries (GitHub: 1000). */
	directoryEntries: 1000,
	/** Contents: a symlink target over this is not read (`target: null`). */
	symlinkTargetBytes: 4096,
	/** Git trees: entries before `truncated: true` (GitHub: 100,000). */
	treeEntries: 10_000,
	/** Git blobs: larger ones are `403` (GitHub: 100 MB). */
	blobBytes: 3 * 1024 * 1024,
	/** A single commit or a comparison lists at most this many files (GitHub: 300). */
	diffFiles: 300,
	/** A single commit's files paged with `page`/`per_page` (GitHub: 3,000). */
	pagedDiffFiles: 3000,
	/** A comparison lists at most this many commits (GitHub: 250). */
	compareCommits: 250,
	patchBudgetBytes: 2 * 1024 * 1024,
	sizeReadConcurrency: 8,
};

export const apiCaps = { ...DEFAULT_API_CAPS };
