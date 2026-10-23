import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleDot, CircleX } from "lucide-react";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { checkRunState } from "@/lib/check-rollup";
import { commitChecksQueryOptions } from "@/lib/query-options";

export type CheckState = "success" | "failure" | "pending";

const LABELS: Record<CheckState, string> = {
	success: "All checks have passed",
	failure: "Some checks were not successful",
	pending: "Checks are still running",
};

const TONES: Record<CheckState, string> = {
	success: "text-success",
	failure: "text-destructive",
	pending: "text-warning",
};

/** The state of a commit's reported checks as one icon. */
export function CheckStateIcon({
	state,
	label = LABELS[state],
	className = "size-4",
}: {
	state: CheckState;
	label?: string;
	className?: string;
}) {
	const Icon =
		state === "success"
			? CircleCheck
			: state === "failure"
				? CircleX
				: CircleDot;
	return (
		<Icon
			role="img"
			aria-label={label}
			className={`${className} shrink-0 ${TONES[state]}`}
		>
			<title>{label}</title>
		</Icon>
	);
}

/** A CI-supplied link is shown only when it is an http(s) URL. */
function safeLink(url: string | null): string | null {
	return url && /^https?:\/\//i.test(url) ? url : null;
}

function Report({
	state,
	name,
	detail,
	url,
}: {
	state: CheckState;
	name: string;
	detail: string | null;
	url: string | null;
}) {
	const href = safeLink(url);
	return (
		<li className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
			<CheckStateIcon state={state} label={`${name}: ${state}`} />
			<span className="min-w-0 flex-1 truncate">
				<span className="font-medium text-bjork-text">{name}</span>
				{detail && <span className="text-bjork-text-soft"> — {detail}</span>}
			</span>
			{href && (
				<a
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className="shrink-0 text-xs text-bjork-text-medium hover:text-bjork-accent"
				>
					Details
				</a>
			)}
		</li>
	);
}

/**
 * What external CI reported for `rev`: one row per status context and check
 * run name. Renders nothing while loading or when nothing was reported.
 */
export function CommitChecks({
	repoId,
	rev,
	embedded = false,
}: {
	repoId: number;
	rev: string;
	/** Inside another panel (the merge box): no surface of its own. */
	embedded?: boolean;
}) {
	const { data } = useQuery(commitChecksQueryOptions(repoId, rev));
	if (!data?.state) return null;
	const total = data.statuses.length + data.runs.length;
	const failing =
		data.statuses.filter((s) => s.state === "failure" || s.state === "error")
			.length + data.runs.filter((r) => checkRunState(r) === "failure").length;
	const summary =
		data.state === "success"
			? `All ${total} ${total === 1 ? "check has" : "checks have"} passed`
			: data.state === "failure"
				? `${failing} of ${total} ${total === 1 ? "check was" : "checks were"} not successful`
				: "Checks are still running";
	const list = (
		<ul className="divide-y divide-bjork-border-muted">
			{data.statuses.map((status) => (
				<Report
					key={`s${status.id}`}
					state={
						status.state === "error" || status.state === "failure"
							? "failure"
							: status.state
					}
					name={status.context}
					detail={status.description}
					url={status.targetUrl}
				/>
			))}
			{data.runs.map((run) => (
				<Report
					key={`r${run.id}`}
					state={checkRunState(run)}
					name={run.name}
					detail={run.title}
					url={run.detailsUrl}
				/>
			))}
		</ul>
	);
	if (embedded) {
		return (
			<div className="border-t border-bjork-border-muted">
				<p className="flex items-center gap-2 px-5 py-3 text-[13px] font-medium text-bjork-text">
					<CheckStateIcon state={data.state} />
					{summary}
				</p>
				{list}
			</div>
		);
	}
	return (
		<Panel>
			<PanelHeader
				title={
					<span className="flex items-center gap-2">
						<CheckStateIcon state={data.state} />
						{summary}
					</span>
				}
			/>
			{list}
		</Panel>
	);
}
