import { useEffect, useState } from "react";
import { requestHighlight } from "@/lib/syntax-highlight-client";

/** Runs Shiki highlighting for `code` in the background worker when `enabled`. */
export function useHighlightedCode(
	code: string,
	language: string,
	enabled: boolean,
) {
	const [html, setHtml] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);

	useEffect(() => {
		if (!enabled || !code) {
			setHtml(null);
			setIsPending(false);
			return;
		}

		let cancelled = false;
		setIsPending(true);

		requestHighlight(code, language)
			.then((result) => {
				if (!cancelled) setHtml(result);
			})
			.catch(() => {
				if (!cancelled) setHtml(null);
			})
			.finally(() => {
				if (!cancelled) setIsPending(false);
			});

		return () => {
			cancelled = true;
		};
	}, [code, language, enabled]);

	return { html, isPending };
}
