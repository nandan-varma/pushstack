/**
 * A follow-up effect of a write that has already committed: a timeline event,
 * an activity row, a notification, a linked issue's close. The write is the
 * change (the review, the merge, the issue edit); the follow-ups describe it.
 * A failed follow-up is logged and does not fail the request, because the
 * caller would report an error for a change that happened, and a retry would
 * then be refused ("already submitted") or duplicate it. See
 * internals/database.md, "Multi-step writes".
 */
import { logError } from "./perf-log";

export async function bestEffort(
	scope: string,
	what: string,
	effect: () => Promise<unknown>,
): Promise<void> {
	try {
		await effect();
	} catch (error) {
		logError(scope, `${what} failed after the write committed`, error);
	}
}
