import { getTagPage } from "../git-read";
import { ownerKeyOf } from "../git-storage-naming";
import type { ApiContext } from "./auth";
import { json, linkHeader, pageParams } from "./http";
import { readableRepository } from "./repo-lookup";
import { commitRef } from "./serializers";

export async function listTags(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const fullName = `${repo.owner.username}/${repo.name}`;
	const params = pageParams(ctx.url.searchParams);
	const { total, tags } = await getTagPage(ownerKeyOf(repo), repo.name, {
		offset: params.offset,
		limit: params.reachable ? params.perPage : 0,
	});
	return json(
		tags.map((tag) => ({
			name: tag.name,
			commit: commitRef({ fullName }, tag.commit),
		})),
		200,
		linkHeader(ctx.url, params, total),
	);
}
