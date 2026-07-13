import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormShell } from "@/components/auth-form-shell";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { authClient } from "../../lib/auth-client";

export const Route = createFileRoute("/auth/reset-password")({
	validateSearch: (search: Record<string, unknown>): { token?: string } => ({
		token: (search.token as string) || undefined,
	}),
	component: ResetPasswordPage,
});

function ResetPasswordPage() {
	const { token = "" } = Route.useSearch();
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState(false);
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (password !== confirm) {
			setError("Passwords do not match");
			return;
		}
		setError("");
		setLoading(true);

		const { error: err } = await authClient.resetPassword({
			newPassword: password,
			token,
		});

		if (err) {
			setError(err.message ?? "An error occurred. Please try again.");
		} else {
			setSuccess(true);
		}
		setLoading(false);
	};

	if (success) {
		return (
			<AuthFormShell title="Password updated">
				<p className="mb-8 text-center text-sm text-[var(--sea-ink-soft)]">
					Your password has been reset. You can now sign in.
				</p>
				<Link to="/auth/login">
					<LoadingButton className="w-full">Sign in</LoadingButton>
				</Link>
			</AuthFormShell>
		);
	}

	return (
		<AuthFormShell
			title="Set new password"
			subtitle="Enter your new password below"
		>
			<form onSubmit={handleSubmit} className="space-y-5">
				<ErrorAlert message={error} />

				<FormField label="New password" htmlFor="password">
					<Input
						id="password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={8}
						autoComplete="new-password"
					/>
				</FormField>

				<FormField label="Confirm password" htmlFor="confirm">
					<Input
						id="confirm"
						type="password"
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
						required
						minLength={8}
						autoComplete="new-password"
					/>
				</FormField>

				<LoadingButton
					type="submit"
					className="w-full"
					isLoading={loading}
					loadingLabel="Saving…"
					disabled={!token}
				>
					Set new password
				</LoadingButton>

				{!token && (
					<p className="text-center text-sm text-[var(--sea-ink-soft)]">
						Invalid or expired reset link.{" "}
						<Link
							to="/auth/forgot-password"
							className="font-medium text-[var(--lagoon-deep)] hover:underline"
						>
							Request a new one
						</Link>
					</p>
				)}
			</form>
		</AuthFormShell>
	);
}
