import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormShell } from "@/components/auth-form-shell";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { authClient } from "@/lib/auth-client";

/**
 * GitHub's `/password_reset`: the request form, or — when the emailed link
 * lands here with `?token=` — the new-password form. Better Auth redirects an
 * unusable link here with `?error=INVALID_TOKEN` instead.
 */
export const Route = createFileRoute("/_auth/password_reset")({
	validateSearch: (
		search: Record<string, unknown>,
	): { token?: string; error?: string } => ({
		token: (search.token as string) || undefined,
		error: (search.error as string) || undefined,
	}),
	component: PasswordResetPage,
});

function PasswordResetPage() {
	const { token } = Route.useSearch();
	return token ? <NewPasswordForm token={token} /> : <RequestResetForm />;
}

function RequestResetForm() {
	const { error: linkError } = Route.useSearch();
	const [email, setEmail] = useState("");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState(false);
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		const { error: err } = await authClient.requestPasswordReset({
			email,
			redirectTo: "/password_reset",
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
			<AuthFormShell title="Check your email">
				<p className="mb-8 text-center text-sm text-muted-foreground">
					If an account exists for {email}, you'll receive reset instructions
					shortly.
				</p>
				<Link to="/login">
					<LoadingButton className="w-full">Back to sign in</LoadingButton>
				</Link>
			</AuthFormShell>
		);
	}

	return (
		<AuthFormShell
			title="Reset your password"
			subtitle="Enter your email to receive reset instructions"
			footer={
				<>
					Remember your password?{" "}
					<Link
						to="/login"
						className="font-medium text-primary hover:underline"
					>
						Sign in
					</Link>
				</>
			}
		>
			<form onSubmit={handleSubmit} className="space-y-3">
				<FormField label="Email" htmlFor="email">
					<Input
						id="email"
						type="email"
						placeholder="you@example.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						autoComplete="email"
					/>
				</FormField>

				<ErrorAlert
					message={
						error ||
						(linkError
							? "That reset link is invalid or has expired. Request a new one."
							: "")
					}
				/>

				<LoadingButton
					type="submit"
					className="w-full"
					isLoading={loading}
					loadingLabel="Sending…"
				>
					Send reset link
				</LoadingButton>
			</form>
		</AuthFormShell>
	);
}

function NewPasswordForm({ token }: { token: string }) {
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
				<p className="mb-8 text-center text-sm text-muted-foreground">
					Your password has been reset. You can now sign in.
				</p>
				<Link to="/login">
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
			<form onSubmit={handleSubmit} className="space-y-3">
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

				<ErrorAlert message={error} />

				<LoadingButton
					type="submit"
					className="w-full"
					isLoading={loading}
					loadingLabel="Saving…"
				>
					Set new password
				</LoadingButton>
			</form>
		</AuthFormShell>
	);
}
