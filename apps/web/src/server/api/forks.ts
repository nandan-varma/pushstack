import { GitInvalidRequestError } from "git-fs-s3";
import { repoFor } from "../git-repo";
import { ownerKeyOf } from "../git-storage-naming";
import { mergeUpstream } from "../git-write";
import { readableUpstream } from "../repository-fork";
import { type ApiContext, callerIdentity } from "./auth";
import { ApiError, json } from "./http";
import { requestBody } from "./input";
import { writableRepository } from "./repo-lookup";
import { fullNameOf } from "./threads";

const MESSAGE = {
	"fast-forward": "Successfully fetched and fast-forwarded from upstream",
	merge: "Successfully fetched and merged from upstream",
	none: "This branch is not behind the upstream",
} as const;

/**
 * `POST /repos/{owner}/{repo}/merge-upstream` (`gh repo sync`): a fork's
 * branch catches up with the parent's branch of the same name.
 */
export async function mergeUpstreamHandler(ctx: ApiContext) {
	const { repo, caller } = await writableRepository(ctx);
	const { branch } = await requestBody(
		ctx,
		"repos/merge-upstream",
		"Repository",
	);
	const parent = await readableUpstream(repo, caller.userId);
	if (!parent) {
		throw new ApiError(
			422,
			"The repository is not a fork of a readable repository",
		);
	}
	const upstreamName = `${fullNameOf(parent)}:${branch}`;
	const identity = await callerIdentity(caller);
	let outcome: Awaited<ReturnType<typeof mergeUpstream>>;
	try {
		outcome = await mergeUpstream(
			ownerKeyOf(repo),
			repo.name,
			repoFor(ownerKeyOf(parent), parent.name),
			branch,
			{
				authorName: identity.name,
				authorEmail: identity.email,
				message: `Merge branch '${branch}' of ${fullNameOf(parent)} into ${branch}`,
			},
		);
	} catch (error) {
		if (error instanceof GitInvalidRequestError) {
			throw new ApiError(422, error.message);
		}
		throw error;
	}
	if (!outcome.success) {
		throw new ApiError(409, outcome.refusal ?? "There are merge conflicts");
	}
	return json({
		message: `${MESSAGE[outcome.mergeType]} ${upstreamName}.`,
		merge_type: outcome.mergeType,
		base_branch: upstreamName,
	});
}
