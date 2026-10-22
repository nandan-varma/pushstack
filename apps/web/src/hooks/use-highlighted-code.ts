import { useEffect, useState } from "react";
import { requestHighlight } from "@/lib/syntax-highlight-client";

type Highlight =
	| { status: "pending" }
	| { status: "done"; html: string }
	| { status: "failed" };

/**
 * Shiki HTML for `code`, highlighted off the main thread. Changing the code
 * resets to pending at once, so a previous file's markup never shows under
 * a new file's name.
 */
export function useHighlightedCode(code: string, language: string) {
	const [state, setState] = useState<Highlight>({ status: "pending" });

	useEffect(() => {
		let cancelled = false;
		setState({ status: "pending" });
		requestHighlight(code, language).then(
			(html) => {
				if (!cancelled) setState({ status: "done", html });
			},
			() => {
				if (!cancelled) setState({ status: "failed" });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [code, language]);

	return state;
}
