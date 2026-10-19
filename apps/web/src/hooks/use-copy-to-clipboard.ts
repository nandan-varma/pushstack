import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The async Clipboard API rejects when the document isn't focused or the
 * context isn't secure; fall back to a hidden textarea and execCommand.
 */
async function writeClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.setAttribute("readonly", "");
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		try {
			return document.execCommand("copy");
		} catch {
			return false;
		} finally {
			textarea.remove();
		}
	}
}

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
			const ok = await writeClipboard(text);
			if (!ok) return false;
			setCopied(true);
			if (timeoutRef.current !== null) {
				clearTimeout(timeoutRef.current);
			}
			timeoutRef.current = setTimeout(() => setCopied(false), resetDelay);
			return true;
		},
		[resetDelay],
	);

	return { copied, copy };
}
