import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { authClient } from "../../lib/auth-client";

export const Route = createFileRoute("/auth/register")({
	component: RegisterPage,
});

function RegisterPage() {
	const [name, setName] = useState("");
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		if (password !== confirmPassword) {
			setError("Passwords do not match");
			return;
		}
		if (password.length < 8) {
			setError("Password must be at least 8 characters");
			return;
		}
		if (username.length < 3) {
			setError("Username must be at least 3 characters");
			return;
		}

		setLoading(true);

		try {
			await authClient.signUp.email(
				{ email, password, name, username },
				{
					onSuccess: () => window.location.assign("/dashboard"),
					onError: (ctx) => {
						setError(ctx.error.message || "Registration failed");
						setLoading(false);
					},
				},
			);
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
					Create your account
				</h1>
				<p className="mt-1.5 text-sm text-[var(--sea-ink-soft)]">
					Join PushStack and start building
				</p>
			</div>

			<form onSubmit={handleSubmit} className="space-y-4">
				{error && (
					<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
						{error}
					</div>
				)}

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							type="text"
							placeholder="Your name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							autoComplete="name"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="username">Username</Label>
						<Input
							id="username"
							type="text"
							placeholder="username"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							required
							autoComplete="username"
							minLength={3}
							maxLength={30}
						/>
					</div>
				</div>

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

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							placeholder="••••••••"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							autoComplete="new-password"
							minLength={8}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="confirmPassword">Confirm</Label>
						<Input
							id="confirmPassword"
							type="password"
							placeholder="••••••••"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							required
							autoComplete="new-password"
						/>
					</div>
				</div>

				<p className="text-xs text-[var(--sea-ink-soft)]">
					3–30 character username. Password must be 8+ characters.
				</p>

				<Button type="submit" className="w-full" disabled={loading}>
					{loading ? "Creating account…" : "Create account"}
				</Button>
			</form>

			<p className="mt-6 text-center text-sm text-[var(--sea-ink-soft)]">
				Already have an account?{" "}
				<a
					href="/auth/login"
					className="font-medium text-[var(--lagoon-deep)] hover:underline"
				>
					Sign in
				</a>
			</p>
		</div>
	);
}
