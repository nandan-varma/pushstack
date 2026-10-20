import { Cards } from "fumadocs-ui/components/card";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";

interface Param {
	name: string;
	type: string;
	description: string;
	optional?: boolean;
}

function ApiSignature({
	name,
	kind = "function",
	signature,
	params = [],
	returns,
	children,
}: {
	name: string;
	kind?: string;
	signature: string;
	params?: Param[];
	returns?: string;
	children?: ReactNode;
}) {
	return (
		<div
			id={name.toLowerCase()}
			className="not-prose my-6 rounded-lg border bg-fd-card p-4 text-fd-card-foreground"
		>
			<div className="mb-2 flex items-center gap-2">
				<span className="rounded bg-fd-muted px-1.5 py-0.5 text-xs text-fd-muted-foreground">
					{kind}
				</span>
				<a href={`#${name.toLowerCase()}`}>
					<code className="font-semibold">{name}</code>
				</a>
			</div>
			<pre className="overflow-x-auto rounded bg-fd-muted p-2 text-sm">
				<code>{signature}</code>
			</pre>
			{params.length > 0 && (
				<table className="my-3 w-full text-sm">
					<thead>
						<tr className="border-b text-left">
							<th className="py-1 pr-2">Parameter</th>
							<th className="py-1 pr-2">Type</th>
							<th className="py-1">Description</th>
						</tr>
					</thead>
					<tbody>
						{params.map((p) => (
							<tr key={p.name} className="border-b align-top last:border-0">
								<td className="py-1 pr-2">
									<code>
										{p.name}
										{p.optional ? "?" : ""}
									</code>
								</td>
								<td className="py-1 pr-2">
									<code>{p.type}</code>
								</td>
								<td
									className="py-1"
									// Authored in this repo's MDX, never user input.
									// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted inline <code> markup
									dangerouslySetInnerHTML={{ __html: p.description }}
								/>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{returns && (
				<p className="my-2 text-sm">
					<strong>Returns:</strong> <code>{returns}</code>
				</p>
			)}
			<div className="prose-sm">{children}</div>
		</div>
	);
}

function PackageExports({
	exports: entries,
}: {
	exports: { path: string; description: string; href?: string }[];
}) {
	return (
		<Cards>
			{entries.map((e) => (
				<a
					key={e.path}
					href={e.href}
					className="block rounded-lg border bg-fd-card p-4 text-sm no-underline transition-colors hover:bg-fd-accent"
				>
					<code className="font-semibold">{e.path}</code>
					<p
						className="mt-2 text-fd-muted-foreground"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted inline <code> markup
						dangerouslySetInnerHTML={{ __html: e.description }}
					/>
				</a>
			))}
		</Cards>
	);
}

function RuntimeSupport({
	runtimes,
}: {
	runtimes: { name: string; supported: boolean; note?: string }[];
}) {
	return (
		<p className="my-4 flex flex-wrap gap-2">
			{runtimes.map((r) => (
				<span
					key={r.name}
					title={r.note}
					className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
						r.supported
							? "border-green-600/40 text-green-700 dark:text-green-400"
							: "border-amber-600/40 text-amber-700 dark:text-amber-400"
					}`}
				>
					{r.name}
				</span>
			))}
		</p>
	);
}

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		Steps,
		Step,
		Tabs,
		Tab,
		ApiSignature,
		PackageExports,
		RuntimeSupport,
		...components,
	} satisfies MDXComponents;
}
