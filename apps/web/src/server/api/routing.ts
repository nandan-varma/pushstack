import { type OperationId, routes } from "@pushstack/api-contract/client";

// Reserved expansions are optional: `/contents` and `/contents/{+path}` name
// the same operation. Compile the contract once; do not parse templates per request.
const ROUTES = Object.entries(routes).flatMap(([id, route]) => {
	const pattern = route.path.replace(
		/\{(\+?)([a-z_]+)\}/g,
		(_, plus: string, name: string) => `${plus ? "*" : ":"}${name}`,
	);
	const base = { id: id as OperationId, method: route.method };
	const compiled = (pattern: string) => ({
		...base,
		pattern,
		parts: pattern.split("/").slice(1),
	});
	return pattern.includes("*")
		? [compiled(pattern.slice(0, pattern.lastIndexOf("/"))), compiled(pattern)]
		: [compiled(pattern)];
});

function matchPattern(
	parts: string[],
	segments: string[],
): Record<string, string> | null {
	const params: Record<string, string> = {};
	for (const [index, part] of parts.entries()) {
		if (part.startsWith("*")) {
			const rest = segments.slice(index);
			if (rest.length === 0) return null;
			params[part.slice(1)] = rest.join("/");
			return params;
		}
		const segment = segments[index];
		if (segment === undefined) return null;
		if (part.startsWith(":")) params[part.slice(1)] = segment;
		else if (part !== segment) return null;
	}
	return segments.length === parts.length ? params : null;
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
