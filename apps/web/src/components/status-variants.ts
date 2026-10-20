import type { ReviewedState } from "@/lib/review-types";

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

export function reviewStatusVariant(
	state: ReviewedState,
): "success" | "destructive" | "default" {
	if (state === "approved") return "success";
	if (state === "changes_requested") return "destructive";
	return "default";
}

export function reviewStatusLabel(state: ReviewedState): string {
	if (state === "approved") return "approved";
	if (state === "changes_requested") return "changes requested";
	return "reviewed";
}
