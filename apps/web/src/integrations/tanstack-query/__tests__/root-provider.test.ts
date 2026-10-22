import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { shouldDehydrateQuery } from "../root-provider";

function queryFor(client: QueryClient, key: string) {
	const query = client.getQueryCache().find({ queryKey: [key] });
	if (!query) throw new Error(`no query ${key}`);
	return query;
}

describe("shouldDehydrateQuery", () => {
	it("sends a query the server fetched", async () => {
		const client = new QueryClient();
		await client.prefetchQuery({ queryKey: ["done"], queryFn: () => 1 });
		expect(shouldDehydrateQuery(queryFor(client, "done"))).toBe(true);
	});

	it("sends a query still in flight, so its result can stream in", () => {
		const client = new QueryClient();
		void client.prefetchQuery({
			queryKey: ["flying"],
			queryFn: () => new Promise(() => {}),
		});
		expect(shouldDehydrateQuery(queryFor(client, "flying"))).toBe(true);
	});

	it("keeps back a query that was only created, never fetched", () => {
		const client = new QueryClient();
		// What useQuery does during a server render: build the query, no fetch.
		new QueryObserver(client, { queryKey: ["created"], queryFn: () => 1 });
		client.getQueryCache().build(client, { queryKey: ["created"] });
		expect(shouldDehydrateQuery(queryFor(client, "created"))).toBe(false);
	});
});
