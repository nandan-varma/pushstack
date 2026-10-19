/** `GET /repos/{owner}/{repo}/tags` */
import { getTags } from "../git-read";
import { ownerKeyOf } from "../git-storage-naming";
import type { ApiContext } from "./auth";
import { pagedList } from "./http";
import { readableRepository } from "./repo-lookup";
import { commitRef } from "./serializers";

export async function listTags(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const fullName = `${repo.owner.username}/${repo.name}`;
	const tags = await getTags(ownerKeyOf(repo), repo.name);
	return pagedList(ctx.url, tags, (tag) => ({
		name: tag.name,
		commit: commitRef({ fullName }, tag.commit),
	}));
}
