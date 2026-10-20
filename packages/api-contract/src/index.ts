/**
 * The `/api/v3` contract: {@link routes} (method, path, docs per operation,
 * keyed by GitHub's operation id), {@link endpoints} (the same operations
 * with their zod schemas) and the resource schemas they share.
 */
export * from "./endpoints";
export * as inputs from "./inputs";
export * as limits from "./limits";
export * as resources from "./resources";
export * from "./route";
export * from "./routes";
