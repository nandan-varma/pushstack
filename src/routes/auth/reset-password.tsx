import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { authClient } from "../../lib/auth-client";

export const Route = createFileRoute("/auth/reset-password")({
	component: ResetPasswordPage,
});

function ResetPasswordPage() {
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState(false);
	const [loading, setLoading] = useState(false);

	const token =
		typeof window !== "undefined"
			? (new URLSearchParams(window.location.search).get("token") ?? "")
			: "";

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
			<div className="island-shell w-full max-w-md rounded-2xl px-8 py-10 text-center">
				<h1 className="display-title mb-2 text-2xl font-bold text-[var(--sea-ink)]">
					Password updated
				</h1>
				<p className="mb-8 text-sm text-[var(--sea-ink-soft)]">
					Your password has been reset. You can now sign in.
				</p>
				<Button
					onClick={() => window.location.assign("/auth/login")}
					className="w-full"
				>
					Sign in
				</Button>
			</div>
		);
	}

	return (
		<div className="island-shell w-full max-w-md rounded-2xl px-8 py-10">
			<div className="mb-8 text-center">
				<h1 className="display-title text-2xl font-bold text-[var(--sea-ink)]">
					Set new password
				</h1>
				<p className="mt-1.5 text-sm text-[var(--sea-ink-soft)]">
					Enter your new password below
				</p>
			</div>

			<form onSubmit={handleSubmit} className="space-y-5">
				{error && (
					<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
						{error}
					</div>
				)}

				<div className="space-y-1.5">
					<Label htmlFor="password">New password</Label>
					<Input
						id="password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={8}
						autoComplete="new-password"
					/>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="confirm">Confirm password</Label>
					<Input
						id="confirm"
						type="password"
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
						required
						minLength={8}
						autoComplete="new-password"
					/>
				</div>

				<Button type="submit" className="w-full" disabled={loading || !token}>
					{loading ? "Saving…" : "Set new password"}
				</Button>

				{!token && (
					<p className="text-center text-sm text-[var(--sea-ink-soft)]">
						Invalid or expired reset link.{" "}
						<a
							href="/auth/forgot-password"
							className="font-medium text-[var(--lagoon-deep)] hover:underline"
						>
							Request a new one
						</a>
					</p>
				)}
			</form>
		</div>
	);
}
