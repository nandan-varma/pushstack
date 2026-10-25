import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormShell } from "@/components/auth-form-shell";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { authSessionQueryOptions } from "@/lib/query-options";
import { TOKEN_SCOPE_LABELS } from "@/lib/token-scopes";
import {
	decideDeviceAuthorization,
	getDeviceAuthorization,
} from "@/server/device-flow";

/**
 * The page `gh auth login` sends the user to (`verification_uri`). The user
 * types the code the terminal showed, checks what it asks for, and approves
 * or denies. Approval is what lets the next poll receive a token.
 */
export const Route = createFileRoute("/login/device")({
	validateSearch: (search: Record<string, unknown>) => ({
		user_code: typeof search.user_code === "string" ? search.user_code : "",
	}),
	beforeLoad: async ({ context: { queryClient } }) => {
		const session = await queryClient.ensureQueryData(
			authSessionQueryOptions(),
		);
		if (!session?.user) throw redirect({ to: "/login" });
	},
	component: DeviceLoginPage,
});

type Pending = NonNullable<Awaited<ReturnType<typeof getDeviceAuthorization>>>;

function DeviceLoginPage() {
	const { user_code: initialCode } = Route.useSearch();
	const [userCode, setUserCode] = useState(initialCode);
	const [pending, setPending] = useState<Pending | null>(null);
	const [notFound, setNotFound] = useState(false);
	const [done, setDone] = useState<"approved" | "denied" | null>(null);

	const lookup = useMutation({
		mutationFn: () => getDeviceAuthorization({ data: { userCode } }),
		onSuccess: (found) => {
			setNotFound(found === null);
			setPending(found);
		},
	});
	const decide = useMutation({
		mutationFn: (approve: boolean) =>
			decideDeviceAuthorization({ data: { userCode, approve } }),
		onSuccess: ({ approved }) => setDone(approved ? "approved" : "denied"),
	});

	if (done) {
		return (
			<AuthFormShell
				title={done === "approved" ? "Device approved" : "Request denied"}
			>
				<p className="text-sm leading-6 text-bjork-text-muted">
					{done === "approved"
						? "You can return to your terminal. It will finish signing in."
						: "The terminal will not receive a token."}
				</p>
			</AuthFormShell>
		);
	}

	return (
		<AuthFormShell
			title="Authorize a device"
			subtitle="Enter the code shown in your terminal."
		>
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					setPending(null);
					setNotFound(false);
					decide.reset();
					lookup.mutate();
				}}
			>
				<Input
					aria-label="Device code"
					placeholder="XXXX-XXXX"
					autoComplete="off"
					value={userCode}
					onChange={(event) => setUserCode(event.target.value)}
				/>
				<LoadingButton
					type="submit"
					className="w-full"
					isLoading={lookup.isPending}
					loadingLabel="Checking…"
				>
					Continue
				</LoadingButton>
			</form>

			{notFound && (
				<ErrorAlert
					className="mt-4"
					message="That code is unknown, expired, or already used."
				/>
			)}

			{pending && (
				<div className="mt-6 space-y-4">
					<p className="text-sm text-bjork-text">
						A device is asking for access to your account with:
					</p>
					<ul className="list-disc space-y-1 pl-5 text-sm text-bjork-text-muted">
						{pending.scopes.map((scope) => (
							<li key={scope}>{TOKEN_SCOPE_LABELS[scope]}</li>
						))}
					</ul>
					{pending.scopes.length === 0 && (
						<p className="text-sm text-bjork-text-muted">
							It asks for no access to repositories.
						</p>
					)}
					<div className="flex gap-3">
						<LoadingButton
							className="flex-1"
							isLoading={decide.isPending}
							loadingLabel="Authorizing…"
							onClick={() => decide.mutate(true)}
						>
							Authorize
						</LoadingButton>
						<LoadingButton
							variant="outline"
							className="flex-1"
							disabled={decide.isPending}
							onClick={() => decide.mutate(false)}
						>
							Deny
						</LoadingButton>
					</div>
				</div>
			)}

			<ErrorAlert
				className="mt-4"
				message={(decide.error ?? lookup.error)?.message ?? ""}
			/>
		</AuthFormShell>
	);
}
