import { useEffect, useState } from "react";

/**
 * An object URL for text content rendered as media — e.g. an SVG shown as an
 * image — revoked on change/unmount. (Binary files are previewed straight
 * from the raw endpoint instead; see src/lib/file-view.ts.)
 */
export function useTextObjectUrl(
	text: string | undefined,
	mimeType: string,
): string | null {
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		if (text === undefined) {
			setUrl(null);
			return;
		}
		const objectUrl = URL.createObjectURL(new Blob([text], { type: mimeType }));
		setUrl(objectUrl);
		return () => URL.revokeObjectURL(objectUrl);
	}, [text, mimeType]);

	return url;
}
