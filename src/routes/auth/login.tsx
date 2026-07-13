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
	const [loading, setLoading] = useState(false);

	const handleSuccess = async () => {
		await queryClient.invalidateQueries({ queryKey: queryKeys.authSession });
		navigate({ to: "/dashboard" });
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const isEmail = identifier.includes("@");

			if (isEmail) {
				await authClient.signIn.email(
					{ email: identifier, password },
					{
						onSuccess: handleSuccess,
						onError: (ctx) => {
							setError(ctx.error.message || "Login failed");
							setLoading(false);
						},
					},
				);
			} else {
				await authClient.signIn.username(
					{ username: identifier, password },
					{
						onSuccess: handleSuccess,
						onError: (ctx) => {
							setError(ctx.error.message || "Login failed");
							setLoading(false);
						},
					},
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
