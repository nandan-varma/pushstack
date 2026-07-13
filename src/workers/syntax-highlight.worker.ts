import {
	bundledLanguages,
	createHighlighter,
	createJavaScriptRegexEngine,
	type BundledLanguage,
	type Highlighter,
	type SpecialLanguage,
	type ThemedToken,
} from "shiki";

export const HIGHLIGHT_THEMES = {
	light: "github-light",
	dark: "github-dark",
} as const;

export type HighlightMode = "html" | "tokens";

export interface HighlightRequest {
	id: number;
	code: string;
	lang: string;
	mode: HighlightMode;
}

export interface HighlightResponse {
	id: number;
	html?: string;
	tokens?: ThemedToken[][];
	error?: string;
}

let highlighterPromise: Promise<Highlighter> | null = null;

type HighlightLanguage = BundledLanguage | SpecialLanguage;

function isBundledLanguage(lang: string): lang is BundledLanguage {
	return lang in bundledLanguages;
}

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: Object.values(HIGHLIGHT_THEMES),
			langs: [],
			engine: createJavaScriptRegexEngine(),
		});
	}
	return highlighterPromise;
}

async function resolveLang(
	highlighter: Highlighter,
	lang: string,
): Promise<HighlightLanguage> {
	const normalized = lang.toLowerCase();
	if (!isBundledLanguage(normalized)) {
		return "plaintext";
	}

	try {
		if (!highlighter.getLoadedLanguages().includes(normalized)) {
			await highlighter.loadLanguage(normalized);
		}
		return normalized;
	} catch {
		return "plaintext";
	}
}

async function highlight(
	code: string,
	lang: string,
	mode: HighlightMode,
): Promise<Pick<HighlightResponse, "html" | "tokens">> {
	const highlighter = await getHighlighter();
	const resolvedLang = await resolveLang(highlighter, lang);

	try {
		if (mode === "tokens") {
			return {
				tokens: highlighter.codeToTokens(code, {
					lang: resolvedLang,
					themes: HIGHLIGHT_THEMES,
				}).tokens,
			};
		}
		return {
			html: highlighter.codeToHtml(code, {
				lang: resolvedLang,
				themes: HIGHLIGHT_THEMES,
			}),
		};
	} catch {
		if (mode === "tokens") {
			return {
				tokens: highlighter.codeToTokens(code, {
					lang: "plaintext",
					themes: HIGHLIGHT_THEMES,
				}).tokens,
			};
		}
		return {
			html: highlighter.codeToHtml(code, {
				lang: "plaintext",
				themes: HIGHLIGHT_THEMES,
			}),
		};
	}
}

const ctx = self as unknown as Worker;

ctx.onmessage = async (event: MessageEvent<HighlightRequest>) => {
	const { id, code, lang, mode } = event.data;
	try {
		const result = await highlight(code, lang, mode);
		ctx.postMessage({ id, ...result } satisfies HighlightResponse);
	} catch (error) {
		ctx.postMessage({
			id,
			error: error instanceof Error ? error.message : "Highlighting failed",
		} satisfies HighlightResponse);
	}
};
