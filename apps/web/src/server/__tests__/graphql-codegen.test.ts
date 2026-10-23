/**
 * @vitest-environment node
 *
 * The committed resolver types (`resolvers/generated.ts`) are exactly what
 * `pnpm graphql:codegen` produces from the vendored SDL, so schema changes
 * can't land without regenerating them (which is what makes `pnpm typecheck`
 * catch resolver/schema drift).
 */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
	GENERATED,
	generateResolverTypes,
} from "../../../scripts/graphql-codegen";

it("resolvers/generated.ts is up to date with the schema", async () => {
	expect(await generateResolverTypes()).toBe(readFileSync(GENERATED, "utf8"));
}, 60_000);
