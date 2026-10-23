import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { combinedStatusState, rollupState } from "#/lib/check-rollup";
import {
	commitRollups,
	latestCommitStatuses,
	listCheckRuns,
} from "./check-store";
import { getCommit } from "./git-read";
import { safeCommitRevSchema, safeCommitShaSchema } from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import { readInput } from "./read-input";
import { readWithAccess } from "./repo-access";

/** Commits one list asks rollups for (a page of history is at most this long). */
const MAX_ROLLUP_SHAS = 100;
/** Reports shown for one commit; the REST API pages through the rest. */
const MAX_SHOWN_REPORTS = 100;

/**
 * What external CI reported for a commit (a branch, tag or sha): the newest
 * status of each context and the newest check run of each name.
 */
export const getCommitChecks = createServerFn({ method: "GET" })
	.validator(
		readInput(z.object({ repoId: z.number(), rev: safeCommitRevSchema })),
	)
	.handler(({ data }) =>
		readWithAccess(`getCommitChecks ${data.rev}`, data.repoId, async (repo) => {
			const { oid } = await getCommit(ownerKeyOf(repo), repo.name, data.rev);
			const [statuses, runs] = await Promise.all([
				latestCommitStatuses(repo.id, oid, { limit: MAX_SHOWN_REPORTS }),
				listCheckRuns(
					repo.id,
					{ headSha: oid },
					{ filter: "latest" },
					{ limit: MAX_SHOWN_REPORTS },
				),
			]);
			return {
				sha: oid,
				state: rollupState(statuses, runs.rows),
				statusState: statuses.length ? combinedStatusState(statuses) : null,
				statuses: statuses.map((row) => ({
					id: row.id,
					context: row.context,
					state: row.state,
					description: row.description,
					targetUrl: row.targetUrl,
				})),
				runs: runs.rows.map((row) => ({
					id: row.id,
					name: row.name,
					status: row.status,
					conclusion: row.conclusion,
					detailsUrl: row.detailsUrl,
					title: row.outputTitle,
				})),
			};
		}),
	);

/** The rolled-up state of each commit in `shas` that has any report. */
export const getCommitRollups = createServerFn({ method: "GET" })
	.validator(
		readInput(
			z.object({
				repoId: z.number(),
				shas: z.array(safeCommitShaSchema).max(MAX_ROLLUP_SHAS),
			}),
		),
	)
	.handler(({ data }) =>
		readWithAccess("getCommitRollups", data.repoId, async (repo) =>
			Object.fromEntries(
				await commitRollups(
					repo.id,
					data.shas.map((sha) => sha.toLowerCase()),
				),
			),
		),
	);
