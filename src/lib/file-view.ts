/**
 * What the blob page gets for a file. Only text small enough to display
 * travels inline; binary and oversized files are fetched from the raw
 * endpoint (`rawFileUrl`) when actually needed — an image, a download —
 * instead of riding along base64-encoded in the page's data.
 */
export type FileView =
	| { kind: "text"; size: number; content: string }
	| { kind: "binary"; size: number }
	| { kind: "too-large"; size: number };

/** Text above this is offered as raw/download instead of rendered inline. */
export const MAX_INLINE_TEXT_BYTES = 1024 * 1024;

/** `/api/raw/{owner}/{repo}/{ref}/{path}`: the file's exact bytes at `ref`. */
export function rawFileUrl({
	owner,
	name,
	ref,
	path,
}: {
	owner: string;
	name: string;
	ref: string;
	path: string;
}): string {
	const segments = [owner, name, ref, ...path.split("/")];
	return `/api/raw/${segments.map(encodeURIComponent).join("/")}`;
}
