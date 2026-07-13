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

export const Route = createFileRoute("/auth/register")({
	component: RegisterPage,
});

function RegisterPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
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
					onSuccess: async () => {
						await queryClient.invalidateQueries({
							queryKey: queryKeys.authSession,
						});
						navigate({ to: "/dashboard" });
					},
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
		<AuthFormShell
			title="Create your account"
			subtitle="Join PushStack and start building"
			showBranding
			footer={
				<>
					Already have an account?{" "}
					<Link
						to="/auth/login"
						className="font-medium text-[var(--lagoon-deep)] hover:underline"
					>
						Sign in
					</Link>
				</>
			}
		>
			<form onSubmit={handleSubmit} className="space-y-4">
				<ErrorAlert message={error} />

				<div className="grid grid-cols-2 gap-4">
					<FormField label="Name" htmlFor="name">
						<Input
							id="name"
							type="text"
							placeholder="Your name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							autoComplete="name"
						/>
					</FormField>
					<FormField label="Username" htmlFor="username">
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
					</FormField>
				</div>

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

				<div className="grid grid-cols-2 gap-4">
					<FormField label="Password" htmlFor="password">
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
					</FormField>
					<FormField label="Confirm" htmlFor="confirmPassword">
						<Input
							id="confirmPassword"
							type="password"
							placeholder="••••••••"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							required
							autoComplete="new-password"
						/>
					</FormField>
				</div>

				<p className="text-xs text-[var(--sea-ink-soft)]">
					3–30 character username. Password must be 8+ characters.
				</p>

				<LoadingButton
					type="submit"
					className="w-full"
					isLoading={loading}
					loadingLabel="Creating account…"
				>
					Create account
				</LoadingButton>
			</form>
		</AuthFormShell>
	);
}
