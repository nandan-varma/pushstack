import { type OperationId, routes } from "@pushstack/api-contract/client";

// Reserved expansions are optional when they end the path: `/contents` and
// `/contents/{+path}` name the same operation. Compile the contract once; do
// not parse templates per request.
const ROUTES = Object.entries(routes).flatMap(([id, route]) => {
	const pattern = route.path.replace(
		/\{(\+?)([a-z_]+)\}/g,
		(_, plus: string, name: string) => `${plus ? "*" : ":"}${name}`,
	);
	const base = { id: id as OperationId, method: route.method };
	const compiled = (pattern: string) => ({
		...base,
		pattern,
		parts: pattern.split("/").filter(Boolean),
	});
	const expansion = pattern.split("/").pop() ?? "";
	return expansion.startsWith("*")
		? [compiled(pattern.slice(0, pattern.lastIndexOf("/"))), compiled(pattern)]
		: [compiled(pattern)];
});

function matchPattern(
	parts: string[],
	segments: string[],
): Record<string, string> | null {
	const params: Record<string, string> = {};
	const expansion = parts.findIndex((part) => part.startsWith("*"));
	const fixed = expansion === -1 ? parts : parts.slice(0, expansion);
	const rest = expansion === -1 ? [] : parts.slice(expansion + 1);
	// An empty expansion is only unambiguous when nothing follows it.
	const shortest = fixed.length + rest.length + (rest.length > 0 ? 1 : 0);
	if (segments.length < shortest) return null;
	for (const [index, part] of fixed.entries()) {
		const segment = segments[index];
		if (segment === undefined) return null;
		if (part.startsWith(":")) params[part.slice(1)] = segment;
		else if (part !== segment) return null;
	}
	if (expansion === -1) {
		return segments.length === fixed.length ? params : null;
	}
	params[(parts[expansion] as string).slice(1)] = segments
		.slice(fixed.length, segments.length - rest.length)
		.join("/");
	for (const [offset, part] of rest.entries()) {
		if (part !== segments[segments.length - rest.length + offset]) return null;
	}
	return params;
}

export function matchApiRoute(method: string, pathname: string) {
	let segments: string[];
	try {
		segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
	} catch {
		return null;
	}
	for (const route of ROUTES) {
		if (route.method !== method) continue;
		const params = matchPattern(route.parts, segments);
		if (params) return { id: route.id, pattern: route.pattern, params };
	}
	return null;
}
