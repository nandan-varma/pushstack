import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormShell } from "@/components/auth-form-shell";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { isReservedName } from "@/lib/reserved-names";
import { authClient } from "../../lib/auth-client";
import { queryKeys } from "../../lib/query-options";
import {
	MAX_USERNAME_LENGTH,
	STORAGE_NAME_HINT,
	STORAGE_NAME_PATTERN,
} from "../../lib/storage-name";

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
	const [verificationEmail, setVerificationEmail] = useState<string | null>(
		null,
	);

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

		if (isReservedName(username)) {
			setError(`"${username}" is reserved and cannot be used as a username`);
			return;
		}

		setLoading(true);

		try {
			await authClient.signUp.email(
				{ email, password, name, username },
				{
					onSuccess: async (ctx) => {
						// requireEmailVerification means signUp creates the account but
						// doesn't establish a session (no `token`) until the user clicks
						// the emailed link — without this check, they'd be silently
						// bounced by the dashboard route guard with zero explanation.
						if (ctx.data?.token) {
							await queryClient.invalidateQueries({
								queryKey: queryKeys.authSession,
							});
							navigate({ to: "/dashboard" });
						} else {
							setLoading(false);
							setVerificationEmail(email);
						}
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

	if (verificationEmail) {
		return (
			<AuthFormShell
				title="Check your email"
				subtitle={`We sent a verification link to ${verificationEmail}`}
				showBranding
				footer={
					<>
						Wrong address?{" "}
						<button
							type="button"
							onClick={() => setVerificationEmail(null)}
							className="font-medium text-primary hover:underline"
						>
							Go back
						</button>
					</>
				}
			>
				<p className="text-center text-sm text-muted-foreground">
					Click the link in that email to verify your account, then{" "}
					<Link
						to="/auth/login"
						className="font-medium text-primary hover:underline"
					>
						sign in
					</Link>
					.
				</p>
			</AuthFormShell>
		);
	}

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
						className="font-medium text-primary hover:underline"
					>
						Sign in
					</Link>
				</>
			}
		>
			<form onSubmit={handleSubmit} className="space-y-3">
				<div className="grid grid-cols-2 gap-3">
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
							maxLength={MAX_USERNAME_LENGTH}
							pattern={STORAGE_NAME_PATTERN}
							title={STORAGE_NAME_HINT}
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

				<div className="grid grid-cols-2 gap-3">
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

				<p className="text-xs text-muted-foreground">
					A 3–30 character username: letters, numbers, dots, hyphens and
					underscores, starting and ending with a letter or number. Password
					must be 8+ characters.
				</p>

				<ErrorAlert message={error} />

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
