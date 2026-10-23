/** Milestone display helpers shared by the milestone pages and the thread sidebar. */

/** Percent of a milestone's issues and pull requests that are closed (0 when empty). */
export function milestoneProgress(openIssues: number, closedIssues: number) {
	const total = openIssues + closedIssues;
	return total === 0 ? 0 : Math.round((closedIssues / total) * 100);
}

/** A due date in UTC, so the server and the browser render the same day. */
export function formatDueOn(dueOn: Date | string): string {
	return new Date(dueOn).toLocaleDateString("en-US", {
		timeZone: "UTC",
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/** `YYYY-MM-DD` for an `<input type="date">`; empty when there is no due date. */
export function dueOnInputValue(dueOn: Date | string | null): string {
	return dueOn ? new Date(dueOn).toISOString().slice(0, 10) : "";
}

/** The Date a `<input type="date">` value names (UTC midnight), or null when empty. */
export function dueOnFromInput(value: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}
