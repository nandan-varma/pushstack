/**
 * How commit statuses and check runs combine into one state. Pure, shared by
 * the REST API (combined status, check suite) and the web UI (merge box,
 * commit lists).
 */

export type StatusState = "error" | "failure" | "pending" | "success";
export type CheckStatus = "queued" | "in_progress" | "completed";
export type CheckConclusion =
	| "action_required"
	| "cancelled"
	| "failure"
	| "neutral"
	| "success"
	| "skipped"
	| "stale"
	| "timed_out";

export interface CheckRunState {
	status: CheckStatus;
	conclusion: CheckConclusion | null;
}

/** GitHub's combined state of a commit's latest statuses (none = `pending`). */
export function combinedStatusState(
	statuses: { state: StatusState }[],
): "failure" | "pending" | "success" {
	if (statuses.some((s) => s.state === "failure" || s.state === "error")) {
		return "failure";
	}
	if (statuses.length === 0 || statuses.some((s) => s.state === "pending")) {
		return "pending";
	}
	return "success";
}

const FAILING: ReadonlySet<CheckConclusion> = new Set([
	"failure",
	"timed_out",
	"cancelled",
	"action_required",
]);

/** A suite's status from its runs (no runs = `queued`). */
export function suiteStatus(runs: CheckRunState[]): CheckStatus {
	if (runs.length === 0) return "queued";
	if (runs.every((run) => run.status === "completed")) return "completed";
	if (runs.some((run) => run.status !== "queued")) return "in_progress";
	return "queued";
}

/** A completed suite's conclusion; null while any run is unfinished. */
export function suiteConclusion(runs: CheckRunState[]): CheckConclusion | null {
	if (suiteStatus(runs) !== "completed") return null;
	const conclusions = runs.map((run) => run.conclusion);
	for (const wanted of [
		"failure",
		"timed_out",
		"cancelled",
		"action_required",
	] as const) {
		if (conclusions.includes(wanted)) return wanted;
	}
	return conclusions.includes("success") ? "success" : "neutral";
}

/** Whether one check run counts as passing, failing or still running. */
export function checkRunState(
	run: CheckRunState,
): "success" | "failure" | "pending" {
	if (run.status !== "completed") return "pending";
	return run.conclusion && FAILING.has(run.conclusion) ? "failure" : "success";
}

/**
 * The state shown next to a commit: failure beats pending beats success.
 * Null when nothing was reported. Pass each context's and name's latest only.
 */
export function rollupState(
	statuses: { state: StatusState }[],
	runs: CheckRunState[],
): "success" | "failure" | "pending" | null {
	if (statuses.length === 0 && runs.length === 0) return null;
	const states = [
		...statuses.map((s) =>
			s.state === "error" || s.state === "failure"
				? ("failure" as const)
				: s.state,
		),
		...runs.map(checkRunState),
	];
	if (states.includes("failure")) return "failure";
	if (states.includes("pending")) return "pending";
	return "success";
}
