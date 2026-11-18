/**
 * Caps on what a writer may create per repository or pull request
 * (`MAX_*_PER_*` in `lib/limits.ts`). Refusing at the cap is a
 * `RepositoryCapacityError`, which the REST dispatcher answers with 422 (GitHub's
 * answer to a rejected create).
 */
import { withLockKey } from "./git-repo-lock";

export class RepositoryCapacityError extends Error {}

/** Throws `message` when `held` has reached `max`. */
export function assertRepositoryCapacity(
	held: number,
	max: number,
	message: string,
): void {
	if (held >= max) throw new RepositoryCapacityError(message);
}

/**
 * Run a count-then-insert cap check under this repository's capacity lease
 * (`repo_locks`, key `caps/<repoId>/lock`). Two creates that both read the
 * same count would otherwise insert past the cap, and Neon's stateless HTTP
 * driver has neither transactions nor advisory locks; the lease row is the
 * same one git writes use, so nothing new is needed. The key is a separate
 * namespace — a git key is `owner/repo` with exactly one slash — so a label
 * create never waits for a push. Not reentrant: `fn` must not take the same
 * lease again.
 */
export function withRepositoryCapacityLock<T>(
	repoId: number,
	fn: () => Promise<T>,
): Promise<T> {
	return withLockKey(`caps/${repoId}/lock`, fn);
}
