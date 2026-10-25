/**
 * Caps on what a writer may create per repository or pull request
 * (`MAX_*_PER_*` in `lib/limits.ts`). Refusing at the cap is a
 * `RepositoryCapacityError`, which the REST dispatcher answers with 422 (GitHub's
 * answer to a rejected create).
 */
export class RepositoryCapacityError extends Error {}

/** Throws `message` when `held` has reached `max`. */
export function assertRepositoryCapacity(
	held: number,
	max: number,
	message: string,
): void {
	if (held >= max) throw new RepositoryCapacityError(message);
}
