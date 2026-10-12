import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query-options";

const createToken = vi.hoisted(() => vi.fn());
const revokeToken = vi.hoisted(() => vi.fn());
vi.mock("@/server/tokens", () => ({
	createToken,
	revokeToken,
	listTokens: vi.fn(),
}));
const revokeSession = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/auth-client", () => ({
	authClient: {
		listSessions: vi.fn(),
		revokeSession,
		revokeOtherSessions: vi.fn(async () => ({ error: null })),
	},
}));

const { AccessTokensSection } = await import("../AccessTokensSection");
const { SessionsSection } = await import("../SessionsSection");
const { DeveloperSection } = await import("../DeveloperSection");

function withData(seed: [readonly unknown[], unknown][], ui: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
	});
	for (const [key, data] of seed) client.setQueryData(key, data);
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.clearAllMocks();
	window.localStorage.clear();
});

describe("AccessTokensSection", () => {
	it("lists tokens and shows a new token once after creating it", async () => {
		const user = userEvent.setup();
		createToken.mockResolvedValue({ id: 2, token: "ghp_secretvalue" });
		withData(
			[
				[
					queryKeys.accessTokens,
					[
						{
							id: 1,
							name: "Laptop",
							scopes: ["repo:read"],
							lastUsedAt: null,
							expiresAt: null,
							createdAt: new Date(),
						},
					],
				],
			],
			<AccessTokensSection />,
		);

		expect(screen.getByText("Laptop")).toBeInTheDocument();
		expect(screen.getByText(/never used/)).toBeInTheDocument();

		await user.type(screen.getByLabelText("Token name"), "CI");
		await user.click(screen.getByRole("button", { name: "Create token" }));

		await waitFor(() =>
			expect(screen.getByDisplayValue("ghp_secretvalue")).toBeInTheDocument(),
		);
		expect(createToken.mock.calls[0]?.[0]).toEqual({
			data: { name: "CI", scopes: ["repo:write"], lifetimeDays: 90 },
		});
	});

	it("revokes a token", async () => {
		const user = userEvent.setup();
		revokeToken.mockResolvedValue(undefined);
		withData(
			[
				[
					queryKeys.accessTokens,
					[
						{
							id: 7,
							name: "Old",
							scopes: ["repo:write"],
							lastUsedAt: null,
							expiresAt: null,
							createdAt: new Date(),
						},
					],
				],
			],
			<AccessTokensSection />,
		);
		await user.click(screen.getByRole("button", { name: "Revoke" }));
		await waitFor(() =>
			expect(revokeToken.mock.calls[0]?.[0]).toEqual({ data: { id: 7 } }),
		);
	});
});

describe("SessionsSection", () => {
	it("marks the current session and signs out another", async () => {
		const user = userEvent.setup();
		const session = (id: string, token: string, userAgent: string) => ({
			id,
			token,
			userAgent,
			ipAddress: "203.0.113.1",
			createdAt: new Date(),
		});
		withData(
			[
				[
					queryKeys.authSessions,
					[session("a", "current", "Firefox"), session("b", "other", "Safari")],
				],
			],
			<SessionsSection currentToken="current" />,
		);

		expect(screen.getByText(/This session/)).toBeInTheDocument();
		const signOuts = screen.getAllByRole("button", { name: "Sign out" });
		expect(signOuts).toHaveLength(1);
		await user.click(signOuts[0] as HTMLElement);
		await waitFor(() =>
			expect(revokeSession).toHaveBeenCalledWith({ token: "other" }),
		);
	});
});

describe("DeveloperSection", () => {
	it("persists the browser perf-log opt-in", async () => {
		vi.stubEnv("DEV", false);
		const user = userEvent.setup();
		render(<DeveloperSection />);
		await user.click(screen.getByRole("switch"));
		expect(window.localStorage.getItem("pushstack:perf-log")).toBe("1");
		vi.unstubAllEnvs();
	});
});
