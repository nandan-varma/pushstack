import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyToClipboard(resetDelay = 2000) {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timeoutRef.current !== null) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const copy = useCallback(
		async (text: string) => {
			try {
				await navigator.clipboard.writeText(text);
				setCopied(true);
				if (timeoutRef.current !== null) {
					clearTimeout(timeoutRef.current);
				}
				timeoutRef.current = setTimeout(() => setCopied(false), resetDelay);
			} catch {
				// Clipboard access may fail in insecure contexts
			}
		},
		[resetDelay],
	);

	return { copied, copy };
}
