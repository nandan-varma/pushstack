/**
 * Tree read/write primitives — re-exported from @nandan-varma/git-fs-s3's
 * /ops (extracted from an earlier version of this exact file). Every caller
 * here already has a resolved `Repo` in hand, so there's no pushstack-specific
 * orchestration to add on top; test coverage lives in that package's own
 * test/ops-tree.test.ts.
 */
export {
	deleteFromTree,
	findTreeEntry,
	listTreeEntries,
	type TreeEntry,
	upsertTree,
} from "@nandan-varma/git-fs-s3/ops";
