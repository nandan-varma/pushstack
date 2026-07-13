import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
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
			<div className="island-shell w-full max-w-md rounded-2xl px-8 py-10 text-center">
				<h1 className="display-title mb-2 text-2xl font-bold text-[var(--sea-ink)]">
					Check your email
				</h1>
				<p className="mb-8 text-sm text-[var(--sea-ink-soft)]">
					If an account exists for {email}, you'll receive reset instructions
					shortly.
				</p>
				<Link to="/auth/login">
					<Button className="w-full">Back to sign in</Button>
				</Link>
			</div>
		);
	}

	return (
		<div className="island-shell w-full max-w-md rounded-2xl px-8 py-10">
			<div className="mb-8 text-center">
				<h1 className="display-title text-2xl font-bold text-[var(--sea-ink)]">
					Reset your password
				</h1>
				<p className="mt-1.5 text-sm text-[var(--sea-ink-soft)]">
					Enter your email to receive reset instructions
				</p>
			</div>

			<form onSubmit={handleSubmit} className="space-y-5">
				{error && (
					<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
						{error}
					</div>
				)}

				<div className="space-y-1.5">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						type="email"
						placeholder="you@example.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						autoComplete="email"
					/>
				</div>

				<Button type="submit" className="w-full" disabled={loading}>
					{loading ? "Sending…" : "Send reset link"}
				</Button>
			</form>

			<p className="mt-6 text-center text-sm text-[var(--sea-ink-soft)]">
				Remember your password?{" "}
				<Link
					to="/auth/login"
					className="font-medium text-[var(--lagoon-deep)] hover:underline"
				>
					Sign in
				</Link>
			</p>
		</div>
	);
}
