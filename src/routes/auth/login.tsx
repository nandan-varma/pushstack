import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { authClient } from "../../lib/auth-client";

export const Route = createFileRoute("/auth/login")({
	component: LoginPage,
});

function LoginPage() {
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

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
						onSuccess: () => window.location.assign("/dashboard"),
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
						onSuccess: () => window.location.assign("/dashboard"),
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
		<div className="island-shell w-full max-w-md rounded-2xl px-8 py-10">
			<div className="mb-8 text-center">
				<div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--lagoon),var(--palm))]">
					<span className="text-sm font-bold text-white">P</span>
				</div>
				<h1 className="display-title text-2xl font-bold text-[var(--sea-ink)]">
					Welcome back
				</h1>
				<p className="mt-1.5 text-sm text-[var(--sea-ink-soft)]">
					Sign in to your PushStack account
				</p>
			</div>

			<form onSubmit={handleSubmit} className="space-y-5">
				{error && (
					<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
						{error}
					</div>
				)}

				<div className="space-y-1.5">
					<Label htmlFor="identifier">Email or username</Label>
					<Input
						id="identifier"
						type="text"
						placeholder="you@example.com"
						value={identifier}
						onChange={(e) => setIdentifier(e.target.value)}
						required
						autoComplete="username"
					/>
				</div>

				<div className="space-y-1.5">
					<div className="flex items-center justify-between">
						<Label htmlFor="password">Password</Label>
						<a
							href="/auth/forgot-password"
							className="text-xs text-[var(--lagoon-deep)] hover:underline"
						>
							Forgot password?
						</a>
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
				</div>

				<Button type="submit" className="w-full" disabled={loading}>
					{loading ? "Signing in…" : "Sign in"}
				</Button>
			</form>

			<p className="mt-6 text-center text-sm text-[var(--sea-ink-soft)]">
				Don't have an account?{" "}
				<a
					href="/auth/register"
					className="font-medium text-[var(--lagoon-deep)] hover:underline"
				>
					Create one
				</a>
			</p>
		</div>
	);
}
