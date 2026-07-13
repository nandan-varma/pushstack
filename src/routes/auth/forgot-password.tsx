import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormShell } from "@/components/auth-form-shell";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { authClient } from "../../lib/auth-client";

export const Route = createFileRoute("/auth/forgot-password")({
	component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
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
			redirectTo: "/auth/reset-password",
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
				<p className="mb-8 text-center text-sm text-[var(--sea-ink-soft)]">
					If an account exists for {email}, you'll receive reset instructions
					shortly.
				</p>
				<Link to="/auth/login">
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
						to="/auth/login"
						className="font-medium text-[var(--lagoon-deep)] hover:underline"
					>
						Sign in
					</Link>
				</>
			}
		>
			<form onSubmit={handleSubmit} className="space-y-5">
				<ErrorAlert message={error} />

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
