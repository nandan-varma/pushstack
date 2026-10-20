import { SITE_URL } from "./site";

export interface SubmoduleLinks {
	repository: string;
	commit: string | null;
}

/** Resolve Git clone URLs for navigation only. No network access or credential forwarding. */
export function submoduleLinks(
	url: string | null,
	oid: string,
	parent: { owner: string; name: string },
): SubmoduleLinks | null {
	if (
		!url ||
		!/^[0-9a-f]{40}$/i.test(oid) ||
		url.includes("\\") ||
		[...url].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
	)
		return null;
	let target: URL;
	try {
		if (url.startsWith("./") || url.startsWith("../")) {
			target = new URL(
				url,
				`${SITE_URL}/api/git/${encodeURIComponent(parent.owner)}/${encodeURIComponent(parent.name)}.git/`,
			);
		} else if (/^[^/@\s]+@[^/:\s]+:/.test(url)) {
			const [, host, path] = /^[^/@\s]+@([^/:\s]+):(.+)$/.exec(url) ?? [];
			if (!host || !path) return null;
			target = new URL(`https://${host}/${path}`);
		} else {
			target = new URL(url);
			if (target.protocol === "ssh:") {
				if (target.port || target.password) return null;
				target = new URL(`https://${target.hostname}${target.pathname}`);
			}
		}
	} catch {
		return null;
	}
	if (
		!["https:", "http:"].includes(target.protocol) ||
		target.username ||
		target.password ||
		target.search ||
		target.hash
	)
		return null;
	const pathname = target.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
	if (target.origin === new URL(SITE_URL).origin) {
		const match = /^\/api\/git\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(
			pathname,
		);
		if (!match) return null;
		const repository = `/${match[1]}/${match[2]}`;
		return { repository, commit: `${repository}/tree/${oid}` };
	}
	const repository = `${target.origin}${pathname}`;
	const suffix =
		target.hostname === "github.com"
			? `/tree/${oid}`
			: target.hostname === "gitlab.com"
				? `/-/tree/${oid}`
				: target.hostname === "bitbucket.org"
					? `/src/${oid}`
					: null;
	return { repository, commit: suffix ? repository + suffix : null };
}
