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
