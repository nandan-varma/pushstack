import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	authSessionQueryOptions,
	issueCommentsQueryOptions,
	postedCommentsQueryOptions,
} from "@/lib/query-options";
import { createComment } from "@/server/comments";
import { ThreadConversation, useThreadComments } from "../ThreadConversation";
import { ToastProvider } from "../toast-provider";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children }: { to: string; children: ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));

vi.mock("@/server/comments", () => ({ createComment: vi.fn() }));
vi.mock("@/components/timeline/ThreadTimeline", () => ({
	ThreadTimeline: ({ onQuote }: { onQuote?: (body: string) => void }) => (
		<button type="button" onClick={() => onQuote?.("quoted text")}>
			Quote reply
		</button>
	),
}));

function setup(
	thread: { issueId: number } | { pullRequestId: number },
	signedIn = true,
	canParticipate = true,
) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Infinity },
			mutations: { retry: false },
		},
	});
	client.setQueryData(
		[...authSessionQueryOptions().queryKey],
		signedIn
			? { user: { id: "user1", name: "Alice", username: "alice" } }
			: null,
	);
	const options = issueCommentsQueryOptions(7);
	function Page() {
		const comments = useThreadComments({
			thread,
			commentsQueryKey: options.queryKey,
		});
		const [visible, setVisible] = useState(true);
		return (
			<>
				<button type="button" onClick={() => setVisible(!visible)}>
					Toggle tab
				</button>
				{visible && (
					<ThreadConversation
						owner="alice"
						name="repo"
						repoId={1}
						number={7}
						commentsOptions={options}
						canParticipate={canParticipate}
						canModerate={false}
						comments={comments}
					/>
				)}
			</>
		);
	}
	render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<Page />
			</ToastProvider>
		</QueryClientProvider>,
	);
	return client;
}

describe("shared thread conversation", () => {
	it.each([{ issueId: 7 }, { pullRequestId: 7 }])(
		"posts to %j and inserts the authored comment",
		async (thread) => {
			vi.mocked(createComment).mockResolvedValueOnce({
				id: 10,
				body: "hello",
				authorId: "user1",
			} as Awaited<ReturnType<typeof createComment>>);
			const client = setup(thread);
			const user = userEvent.setup();
			await user.type(
				screen.getByRole("textbox", { name: "Add a comment" }),
				"hello",
			);
			await user.click(screen.getByRole("button", { name: "Comment" }));
			await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
			expect(createComment).toHaveBeenLastCalledWith(
				{ data: { ...thread, body: "hello" } },
				expect.anything(),
			);
			expect(
				client.getQueryData(
					postedCommentsQueryOptions(issueCommentsQueryOptions(7).queryKey)
						.queryKey,
				),
			).toMatchObject([{ id: 10, author: { username: "alice" } }]);
		},
	);
	it("preserves drafts and appended quotes across conversation tab unmounts", async () => {
		setup({ pullRequestId: 7 });
		const user = userEvent.setup();
		await user.type(screen.getByRole("textbox"), "draft");
		await user.click(screen.getByRole("button", { name: "Quote reply" }));
		const value = (screen.getByRole("textbox") as HTMLTextAreaElement).value;
		expect(value).toContain("> quoted text");
		await user.click(screen.getByRole("button", { name: "Toggle tab" }));
		await user.click(screen.getByRole("button", { name: "Toggle tab" }));
		expect(screen.getByRole("textbox")).toHaveValue(value);
	});
	it("retains the draft after posting fails", async () => {
		vi.mocked(createComment).mockRejectedValueOnce(new Error("offline"));
		setup({ issueId: 7 });
		const user = userEvent.setup();
		await user.type(screen.getByRole("textbox"), "keep me");
		await user.click(screen.getByRole("button", { name: "Comment" }));
		await screen.findByText("offline");
		expect(screen.getByRole("textbox")).toHaveValue("keep me");
	});
	it("offers sign in to anonymous readers", () => {
		setup({ issueId: 7 }, false, false);
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(
			screen.getByText("Sign in to join this conversation."),
		).toBeInTheDocument();
	});
	it("does not offer a reply to signed-in readers without participation", () => {
		setup({ issueId: 7 }, true, false);
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByText(/Sign in/)).toBeNull();
	});
});
