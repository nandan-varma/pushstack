/**
 * Map file extensions to Shiki language ids for syntax highlighting.
 * Ids must match https://shiki.style/languages (or "plaintext" for unmapped files).
 */

/** Above this size, auto-highlighting is skipped and the user must opt in. */
export const MAX_AUTO_HIGHLIGHT_BYTES = 512 * 1024;
/** Above this line count, auto-highlighting is skipped and the user must opt in. */
export const MAX_AUTO_HIGHLIGHT_LINES = 5000;

/** Cheap large-file check (avoids allocating a full split() array for huge content). */
export function isLargeContent(code: string): boolean {
	if (code.length > MAX_AUTO_HIGHLIGHT_BYTES) return true;

	let lines = 1;
	for (let i = 0; i < code.length; i++) {
		if (code.charCodeAt(i) === 10) {
			lines++;
			if (lines > MAX_AUTO_HIGHLIGHT_LINES) return true;
		}
	}
	return false;
}

export const LANGUAGE_MAP: Record<string, string> = {
	// JavaScript/TypeScript
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "jsx",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "tsx",
	coffee: "coffee",

	// Web
	html: "html",
	htm: "html",
	xhtml: "html",
	vue: "vue",
	svelte: "svelte",
	astro: "astro",
	css: "css",
	scss: "scss",
	sass: "sass",
	less: "less",
	styl: "stylus",
	stylus: "stylus",
	pug: "pug",
	jade: "pug",
	haml: "haml",
	hbs: "handlebars",
	handlebars: "handlebars",
	ejs: "erb",
	erb: "erb",
	liquid: "liquid",
	twig: "twig",
	marko: "marko",
	imba: "imba",

	// Python
	py: "python",
	pyw: "python",
	pyi: "python",

	// Java/JVM
	java: "java",
	kt: "kotlin",
	kts: "kotlin",
	scala: "scala",
	sc: "scala",
	groovy: "groovy",
	gvy: "groovy",
	gradle: "groovy",
	clj: "clojure",
	cljs: "clojure",
	cljc: "clojure",

	// C/C++
	c: "c",
	h: "c",
	cpp: "cpp",
	"c++": "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	hh: "cpp",
	hxx: "cpp",

	// C#/.NET
	cs: "csharp",
	csx: "csharp",
	vb: "vb",
	fs: "fsharp",
	fsx: "fsharp",
	fsi: "fsharp",

	// Objective-C/Swift
	m: "objective-c",
	mm: "objective-cpp",
	swift: "swift",

	// Go
	go: "go",
	"go.mod": "go",
	"go.sum": "go",

	// Rust
	rs: "rust",

	// PHP
	php: "php",
	php3: "php",
	php4: "php",
	php5: "php",
	phtml: "php",
	blade: "blade",

	// Ruby
	rb: "ruby",
	rbw: "ruby",
	gemspec: "ruby",
	rake: "ruby",

	// Shell
	sh: "shellscript",
	bash: "shellscript",
	zsh: "shellscript",
	ksh: "shellscript",
	fish: "fish",
	ps1: "powershell",
	psm1: "powershell",
	psd1: "powershell",
	bat: "bat",
	cmd: "bat",
	awk: "awk",
	nu: "nushell",

	// Config / data
	json: "json",
	json5: "json5",
	jsonc: "jsonc",
	jsonl: "jsonl",
	ndjson: "jsonl",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	ini: "ini",
	cfg: "ini",
	conf: "ini",
	env: "dotenv",
	properties: "ini",
	editorconfig: "ini",
	csv: "csv",
	tsv: "tsv",
	hcl: "hcl",
	tf: "terraform",
	tfvars: "terraform",
	nix: "nix",
	kdl: "kdl",
	ron: "ron",

	// Markup / docs
	md: "markdown",
	markdown: "markdown",
	mdx: "mdx",
	mdc: "mdc",
	rst: "rst",
	adoc: "asciidoc",
	asciidoc: "asciidoc",
	tex: "tex",
	latex: "latex",
	bib: "bibtex",
	xml: "xml",
	svg: "xml",
	xsl: "xsl",
	wsdl: "xml",
	plist: "xml",
	wikitext: "wikitext",
	textile: "wikitext",

	// SQL / query languages
	sql: "sql",
	psql: "plsql",
	plsql: "plsql",
	graphql: "graphql",
	gql: "graphql",
	cypher: "cypher",
	sparql: "sparql",
	kusto: "kusto",
	kql: "kusto",

	// Infra / build
	dockerfile: "docker",
	makefile: "make",
	mk: "make",
	cmake: "cmake",
	just: "just",
	justfile: "just",
	nginxconf: "nginx",
	proto: "proto",
	thrift: "proto",

	// Functional / other languages
	hs: "haskell",
	lhs: "haskell",
	elm: "elm",
	erl: "erlang",
	hrl: "erlang",
	ex: "elixir",
	exs: "elixir",
	eex: "elixir",
	heex: "elixir",
	lisp: "common-lisp",
	lsp: "common-lisp",
	el: "emacs-lisp",
	scm: "scheme",
	ss: "scheme",
	rkt: "racket",
	ml: "ocaml",
	mli: "ocaml",
	re: "ocaml",
	nim: "nim",
	nims: "nim",
	zig: "zig",
	odin: "odin",
	v: "v",
	d: "d",
	cr: "crystal",
	jl: "julia",
	lua: "lua",
	perl: "perl",
	pl: "perl",
	pm: "perl",
	raku: "raku",
	r: "r",
	rdata: "r",
	dart: "dart",
	pas: "pascal",
	pp: "puppet",
	tcl: "tcl",
	prolog: "prolog",
	pro: "prolog",
	f: "fortran-fixed-form",
	f90: "fortran-free-form",
	f95: "fortran-free-form",
	asm: "asm",
	s: "asm",
	vhdl: "vhdl",
	vhd: "vhdl",
	verilog: "verilog",
	sv: "system-verilog",
	svh: "system-verilog",
	cob: "cobol",
	cbl: "cobol",
	abap: "abap",
	apex: "apex",
	sol: "solidity",
	vy: "vyper",
	move: "move",
	cadence: "cadence",
	cdc: "cadence",
	wasm: "wasm",
	wat: "wasm",
	wgsl: "wgsl",
	glsl: "glsl",
	vert: "glsl",
	frag: "glsl",
	hlsl: "hlsl",
	prisma: "prisma",
	purs: "purescript",
	wolfram: "wolfram",
	wl: "wolfram",
	applescript: "applescript",
	as: "actionscript-3",

	// Misc / version control
	diff: "diff",
	patch: "diff",
	log: "log",
	http: "http",
	vim: "viml",
	vimrc: "viml",
	desktop: "desktop",
	service: "systemd",
	systemd: "systemd",
};

const SPECIAL_FILENAMES: Record<string, string> = {
	dockerfile: "docker",
	makefile: "make",
	gnumakefile: "make",
	rakefile: "ruby",
	gemfile: "ruby",
	"gemfile.lock": "ruby",
	vagrantfile: "ruby",
	brewfile: "ruby",
	cmakelists: "cmake",
	justfile: "just",
	".gitignore": "shellscript",
	".gitattributes": "shellscript",
	".dockerignore": "shellscript",
	".env": "dotenv",
	".editorconfig": "ini",
	".npmrc": "ini",
	".yarnrc": "ini",
	".babelrc": "json",
	".eslintrc": "json",
	".prettierrc": "json",
};

/**
 * Detect Shiki language id from a file path.
 */
export function detectLanguage(filePath: string): string {
	const baseName = (filePath.split("/").pop() || "").toLowerCase();

	if (SPECIAL_FILENAMES[baseName]) {
		return SPECIAL_FILENAMES[baseName];
	}
	if (baseName.startsWith("dockerfile")) return "docker";
	if (baseName.startsWith("makefile")) return "make";
	if (baseName.endsWith(".env") || baseName.startsWith(".env")) return "dotenv";

	const extension = baseName.split(".").pop() || "";
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

	return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}
