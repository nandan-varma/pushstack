/**
 * Map file extensions to programming language identifiers for syntax highlighting
 */

export const LANGUAGE_MAP: Record<string, string> = {
	// JavaScript/TypeScript
	js: "javascript",
	jsx: "jsx",
	ts: "typescript",
	tsx: "tsx",

	// Web
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	sass: "sass",
	less: "less",

	// Python
	py: "python",
	pyw: "python",

	// Java/JVM
	java: "java",
	kt: "kotlin",
	scala: "scala",
	groovy: "groovy",

	// C/C++
	c: "c",
	h: "c",
	cpp: "cpp",
	"c++": "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",

	// C#
	cs: "csharp",

	// Go
	go: "go",

	// Rust
	rs: "rust",

	// PHP
	php: "php",

	// Ruby
	rb: "ruby",

	// Shell
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "fish",

	// Config
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	ini: "ini",
	conf: "ini",

	// Markup
	md: "markdown",
	markdown: "markdown",
	xml: "xml",
	svg: "xml",

	// SQL
	sql: "sql",

	// Others
	r: "r",
	swift: "swift",
	vim: "vim",
	diff: "diff",
	dockerfile: "dockerfile",
	makefile: "makefile",
	graphql: "graphql",
	proto: "protobuf",
};

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): string {
	const extension = filePath.split(".").pop()?.toLowerCase() || "";

	// Special cases
	if (filePath.endsWith("Dockerfile")) return "dockerfile";
	if (filePath.endsWith("Makefile")) return "makefile";
	if (filePath.endsWith(".gitignore")) return "bash";
	if (filePath.endsWith(".env")) return "bash";

	return LANGUAGE_MAP[extension] || "plaintext";
}

/**
 * Check if file is binary based on extension
 */
export function isBinaryFile(filePath: string): boolean {
	const binaryExtensions = [
		"png",
		"jpg",
		"jpeg",
		"gif",
		"bmp",
		"ico",
		"svg",
		"pdf",
		"zip",
		"tar",
		"gz",
		"rar",
		"7z",
		"exe",
		"dll",
		"so",
		"dylib",
		"mp3",
		"mp4",
		"avi",
		"mov",
		"wav",
		"woff",
		"woff2",
		"ttf",
		"eot",
	];

	const extension = filePath.split(".").pop()?.toLowerCase() || "";
	return binaryExtensions.includes(extension);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";

	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return parseFloat((bytes / k ** i).toFixed(2)) + " " + sizes[i];
}
