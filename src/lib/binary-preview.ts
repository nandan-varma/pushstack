import { useEffect, useState } from "react";

export function base64ToObjectUrl(base64: string, mimeType: string): string {
	const binary = window.atob(base64);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	const blob = new Blob([bytes], { type: mimeType });
	return URL.createObjectURL(blob);
}

/** Creates an object URL for base64 content and revokes it on change/unmount. */
export function useBinaryObjectUrl(
	base64: string | undefined,
	mimeType: string,
): string | null {
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!base64) {
			setUrl(null);
			return;
		}

		const objectUrl = base64ToObjectUrl(base64, mimeType);
		setUrl(objectUrl);

		return () => URL.revokeObjectURL(objectUrl);
	}, [base64, mimeType]);

	return url;
}
