import { parseArgs } from "node:util";
import { CliError, type Io } from "./io";

type Options = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

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

/** Rejects `--json` with no or unknown fields before any request is made. */
export function assertJsonFields(
	fields: string | undefined,
	available: Record<string, unknown>,
) {
	if (fields === undefined) return;
	if (
		!fields ||
		fields.split(",").some((field) => !Object.hasOwn(available, field))
	) {
		throw new CliError(
			`Invalid JSON fields: "${fields}"\nAvailable fields:\n  ${Object.keys(available).sort().join("\n  ")}`,
		);
	}
}

/** Prints one resource or a list as JSON, each reduced to the `--json` fields. */
export function printJsonFields<T extends Record<string, unknown>>(
	io: Io,
	fields: string,
	available: Record<string, (value: never) => unknown>,
	value: T | T[],
) {
	const pick = (item: T) => pickFields(fields, available, item);
	io.stdout(
		`${JSON.stringify(Array.isArray(value) ? value.map(pick) : pick(value), null, 2)}\n`,
	);
}
