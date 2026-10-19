import { parseArgs } from "node:util";
import { CliError } from "./io";

type Options = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

/** `parseArgs` with usage errors turned into CliErrors. */
export function parse<O extends NonNullable<Options>>(
	args: string[],
	options: O,
	{ positionals = true }: { positionals?: boolean } = {},
) {
	try {
		return parseArgs({
			args,
			options,
			allowPositionals: positionals,
			strict: true,
		});
	} catch (error) {
		throw new CliError((error as Error).message);
	}
}

/** `--json a,b` → the value picked per field. Unknown fields list the valid ones, like gh. */
export function pickFields<T extends Record<string, unknown>>(
	fieldsArg: string,
	available: Record<string, (value: never) => unknown>,
	source: T,
) {
	const fields = fieldsArg.split(",").filter(Boolean);
	const unknown = fields.filter((f) => !(f in available));
	if (unknown.length > 0) {
		throw new CliError(
			`Unknown JSON field: "${unknown[0]}"\nAvailable fields:\n  ${Object.keys(available).sort().join("\n  ")}`,
		);
	}
	const out: Record<string, unknown> = {};
	for (const field of fields) {
		out[field] = (available[field] as (value: T) => unknown)(source);
	}
	return out;
}
