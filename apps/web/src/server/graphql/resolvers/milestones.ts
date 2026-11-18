/**
 * Milestones: `Repository.milestones` over milestone-store.ts (the same store
 * REST and the milestone pages use), and the `Milestone` an issue or pull
 * request carries. The repository resolver has already checked read access.
 */
import { MAX_MILESTONE_TITLE_CHARS } from "#/lib/limits";
import { isoTimestamp } from "../../api/http";
import {
	findMilestoneById,
	listMilestones,
	type MilestoneView,
} from "../../milestone-store";
import { countedConnection } from "../connection";
import { notFound, unprocessable } from "../errors";
import { decodeNodeId, encodeNodeId, rowIdOfNodeKey } from "../node-id";
import type { RepositoryMilestonesArgs } from "./generated";
import type { RepositoryNode } from "./repository";

export interface MilestoneNode {
	__typename: "Milestone";
	id: string;
	number: number;
	title: string;
	description: string | null;
	dueOn: string | null;
	state: "OPEN" | "CLOSED";
}

export function milestoneNode(view: MilestoneView): MilestoneNode {
	return {
		__typename: "Milestone",
		id: encodeNodeId("Milestone", view.id),
		number: view.number,
		title: view.title,
		description: view.description,
		dueOn: view.dueOn ? isoTimestamp(view.dueOn) : null,
		state: view.state === "closed" ? "CLOSED" : "OPEN",
	};
}

/** MilestoneOrderField as the store's sorts; every one tiebreaks by number. */
const SORTS = {
	CREATED_AT: "created_at",
	DUE_DATE: "due_on",
	NUMBER: "number",
	UPDATED_AT: "updated_at",
} as const;

async function repositoryMilestones(
	source: RepositoryNode,
	args: RepositoryMilestonesArgs,
) {
	const query = args.query?.trim() ?? "";
	if (query.length > MAX_MILESTONE_TITLE_CHARS) {
		throw unprocessable(
			`The milestone search is too long (maximum is ${MAX_MILESTONE_TITLE_CHARS} characters).`,
		);
	}
	// An absent list names both states; a list naming neither matches nothing.
	const states = args.states ?? null;
	const open = states === null || states.includes("OPEN");
	const closed = states === null || states.includes("CLOSED");
	const state =
		open && closed ? "all" : open ? "open" : closed ? "closed" : null;
	return countedConnection(args, async (offset, limit) => {
		if (state === null) return { items: [], total: 0 };
		const { milestones, total } = await listMilestones(source.row.id, {
			state,
			sort: SORTS[args.orderBy?.field ?? "DUE_DATE"],
			direction: args.orderBy?.direction === "DESC" ? "desc" : "asc",
			query: query || undefined,
			offset,
			limit,
		});
		return { items: milestones.map(milestoneNode), total };
	});
}

/** The number of the milestone `nodeId` names in `repo`, or NOT_FOUND. */
export async function milestoneNumberOf(
	repo: RepositoryNode,
	nodeId: string,
): Promise<number> {
	const decoded = decodeNodeId(nodeId);
	const id = decoded?.type === "Milestone" ? rowIdOfNodeKey(decoded.key) : null;
	const row = id === null ? null : await findMilestoneById(id);
	if (row?.repoId !== repo.row.id) {
		throw notFound(
			`Could not resolve to a node with the global id of '${nodeId}'`,
		);
	}
	return row.number;
}

/** Repository fields, merged into repository.ts. */
export const repositoryMilestoneFields = {
	milestones: (source: RepositoryNode, args: RepositoryMilestonesArgs) =>
		repositoryMilestones(source, args),
};
