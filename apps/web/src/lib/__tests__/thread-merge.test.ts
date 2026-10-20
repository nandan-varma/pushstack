import { describe, expect, it } from "vitest";
import { mergeThreadItems } from "../thread-merge";

type Row = ReturnType<typeof c>;
const at = (n: number) => new Date(n * 1000);
const c = (id: number, t: number) => ({ id, createdAt: at(t) });
const ids = (r: ReturnType<typeof mergeThreadItems<Row, Row>>) =>
	r.items.map((i) =>
		i.kind === "comment" ? `c${i.comment.id}` : `e${i.event.id}`,
	);

describe("mergeThreadItems", () => {
	it("interleaves complete sources chronologically", () => {
		const r = mergeThreadItems(
			{ loaded: [c(1, 1), c(2, 4)], hasMore: false },
			{ loaded: [c(1, 2), c(2, 3)], hasMore: false },
		);
		expect(ids(r)).toEqual(["c1", "e1", "e2", "c2"]);
		expect(r.hasMore).toBe(false);
	});

	it("holds back events newer than the last loaded comment while comments page", () => {
		const r = mergeThreadItems(
			{ loaded: [c(1, 1), c(2, 5)], hasMore: true },
			{ loaded: [c(1, 3), c(2, 9)], hasMore: false },
		);
		expect(ids(r)).toEqual(["c1", "e1", "c2"]);
		expect(r.hasMore).toBe(true);
	});

	it("holds back comments newer than the last loaded event while events page", () => {
		const r = mergeThreadItems(
			{ loaded: [c(1, 3), c(2, 9)], hasMore: false },
			{ loaded: [c(1, 1), c(2, 5)], hasMore: true },
		);
		expect(ids(r)).toEqual(["e1", "c1", "e2"]);
	});

	it("shows everything of a complete source once the other is exhausted", () => {
		const r = mergeThreadItems(
			{ loaded: [c(1, 8)], hasMore: false },
			{ loaded: [c(1, 1)], hasMore: false },
		);
		expect(ids(r)).toEqual(["e1", "c1"]);
	});

	it("keeps an event sharing the comments' boundary instant until the next page", () => {
		const r = mergeThreadItems(
			{ loaded: [c(1, 5)], hasMore: true },
			{ loaded: [c(1, 5)], hasMore: false },
		);
		expect(ids(r)).toEqual(["c1"]);
	});

	it("shows a comment sharing the events' boundary instant, ahead of the event", () => {
		const r = mergeThreadItems(
			{ loaded: [c(1, 5)], hasMore: false },
			{ loaded: [c(1, 5)], hasMore: true },
		);
		expect(ids(r)).toEqual(["c1", "e1"]);
	});

	it("handles an empty source", () => {
		expect(
			ids(
				mergeThreadItems(
					{ loaded: [], hasMore: false },
					{ loaded: [c(1, 1)], hasMore: false },
				),
			),
		).toEqual(["e1"]);
		expect(
			mergeThreadItems(
				{ loaded: [], hasMore: false },
				{ loaded: [], hasMore: false },
			),
		).toEqual({ items: [], hasMore: false });
	});

	it("appends the viewer's new comment after the visible thread while pages remain", () => {
		const r = mergeThreadItems(
			{ loaded: [c(1, 1)], hasMore: true },
			{ loaded: [], hasMore: false },
			[c(99, 50)],
		);
		expect(ids(r)).toEqual(["c1", "c99"]);
	});

	it("places it chronologically once every comment is loaded, and never twice", () => {
		const done = { loaded: [c(1, 1)], hasMore: false };
		const events = { loaded: [c(1, 7)], hasMore: false };
		expect(ids(mergeThreadItems(done, events, [c(99, 9)]))).toEqual([
			"c1",
			"e1",
			"c99",
		]);
		expect(ids(mergeThreadItems(done, events, [c(1, 1)]))).toEqual([
			"c1",
			"e1",
		]);
	});
});
