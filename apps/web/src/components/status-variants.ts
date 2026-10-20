export function issueStatusVariant(status: string): "success" | "default" {
	return status === "open" ? "success" : "default";
}

export function pullRequestStatusVariant(
	status: string,
): "success" | "info" | "default" {
	if (status === "open") return "success";
	if (status === "merged") return "info";
	return "default";
}

/** The aggregate review state on a pull request's header. */
export function reviewStatusVariant(
	state: string,
): "success" | "destructive" | "default" {
	if (state === "approved") return "success";
	if (state === "changes_requested") return "destructive";
	return "default";
}

export function reviewStatusLabel(state: string): string {
	if (state === "approved") return "approved";
	if (state === "changes_requested") return "changes requested";
	return "reviewed";
}
