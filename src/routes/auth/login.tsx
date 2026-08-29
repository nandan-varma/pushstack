import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormShell } from "@/components/auth-form-shell";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { authClient } from "../../lib/auth-client";
import { queryKeys } from "../../lib/query-options";

export const Route = createFileRoute("/auth/login")({
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [errorCode, setErrorCode] = useState("");
	const [loading, setLoading] = useState(false);
	const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">(
		"idle",
	);

	const handleResend = async () => {
		if (!identifier.includes("@")) return;
		setResendStatus("sending");
		try {
			await authClient.sendVerificationEmail(
				{ email: identifier },
				{
					onSuccess: () => setResendStatus("sent"),
					onError: (ctx) => {
						setError(
							ctx.error.message || "Failed to resend verification email",
						);
						setResendStatus("idle");
					},
				},
			);
		} catch {
			setError("Failed to resend verification email");
			setResendStatus("idle");
		}
	};

	const handleSuccess = async () => {
		await queryClient.invalidateQueries({ queryKey: queryKeys.authSession });
		navigate({ to: "/dashboard" });
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setErrorCode("");
		setResendStatus("idle");
		setLoading(true);

		const onError = (ctx: { error: { message?: string; code?: string } }) => {
			setError(ctx.error.message || "Login failed");
			setErrorCode(ctx.error.code || "");
			setLoading(false);
		};

		try {
			const isEmail = identifier.includes("@");

			if (isEmail) {
				await authClient.signIn.email(
					{ email: identifier, password },
					{ onSuccess: handleSuccess, onError },
				);
			} else {
				await authClient.signIn.username(
					{ username: identifier, password },
					{ onSuccess: handleSuccess, onError },
				);
			}
		} catch {
			setError("An unexpected error occurred");
			setLoading(false);
		}
	};

	return (
		<AuthFormShell
			title="Welcome back"
			subtitle="Sign in to your PushStack account"
			showBranding
			footer={
				<>
					Don't have an account?{" "}
					<Link
						to="/auth/register"
						className="font-medium text-[var(--lagoon-deep)] hover:underline"
					>
						Create one
					</Link>
				</>
			}
		>
			<form onSubmit={handleSubmit} className="space-y-5">
				<ErrorAlert message={error} />
				{errorCode === "EMAIL_NOT_VERIFIED" && identifier.includes("@") && (
					<p className="-mt-3 text-sm text-[var(--sea-ink-soft)]">
						{resendStatus === "sent" ? (
							"Verification email sent — check your inbox."
						) : (
							<button
								type="button"
								onClick={handleResend}
								disabled={resendStatus === "sending"}
								className="font-medium text-[var(--lagoon-deep)] hover:underline disabled:opacity-60"
							>
								{resendStatus === "sending"
									? "Sending…"
									: "Resend verification email"}
							</button>
						)}
					</p>
				)}

				<FormField label="Email or username" htmlFor="identifier">
					<Input
						id="identifier"
						type="text"
						placeholder="you@example.com"
						value={identifier}
						onChange={(e) => setIdentifier(e.target.value)}
						required
						autoComplete="username"
					/>
				</FormField>

				<FormField label="Password" htmlFor="password">
					<div className="flex items-center justify-between">
						<span />
						<Link
							to="/auth/forgot-password"
							className="text-xs text-[var(--lagoon-deep)] hover:underline"
						>
							Forgot password?
						</Link>
					</div>
					<Input
						id="password"
						type="password"
						placeholder="••••••••"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						autoComplete="current-password"
					/>
				</FormField>

				<LoadingButton
					type="submit"
					className="w-full"
					isLoading={loading}
					loadingLabel="Signing in…"
				>
					Sign in
				</LoadingButton>
			</form>
		</AuthFormShell>
	);
}
