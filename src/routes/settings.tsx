import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { getSession } from "@/lib/auth-session";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";

export const Route = createFileRoute("/settings")({
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) throw redirect({ to: "/auth/login" });
	},
	component: SettingsPage,
});

const inputCls =
	"w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]";
const labelCls = "block text-sm font-medium text-[var(--sea-ink)] mb-1";

function Section({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<Card className="p-6">
			<h2 className="mb-1 text-base font-semibold text-[var(--sea-ink)]">{title}</h2>
			{description && (
				<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">{description}</p>
			)}
			{children}
		</Card>
	);
}

function ProfileSection({
	name,
	email,
}: {
	name: string;
	email: string;
}) {
	const queryClient = useQueryClient();
	const [displayName, setDisplayName] = useState(name);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState(false);

	const save = async () => {
		if (!displayName.trim() || displayName === name) return;
		setLoading(true);
		setError("");
		const { error: err } = await authClient.updateUser({ name: displayName.trim() });
		setLoading(false);
		if (err) {
			setError(err.message ?? "Failed to update profile");
		} else {
			await queryClient.invalidateQueries({ queryKey: queryKeys.authSession });
			setSuccess(true);
			setTimeout(() => setSuccess(false), 2500);
		}
	};

	return (
		<Section title="Profile" description="Your public display name and email.">
			<div className="space-y-4">
				<div>
					<label htmlFor="display-name" className={labelCls}>
						Display name
					</label>
					<input
						id="display-name"
						className={inputCls}
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && save()}
					/>
				</div>
				<div>
					<label className={labelCls}>Email</label>
					<input className={`${inputCls} opacity-60`} value={email} disabled />
					<p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
						Change your email in the Email section below.
					</p>
				</div>
				{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
				<div className="flex items-center gap-3">
					<Button
						disabled={loading || !displayName.trim() || displayName === name}
						onClick={save}
					>
						{loading ? "Saving…" : "Save"}
					</Button>
					{success && (
						<span className="text-sm text-green-600 dark:text-green-400">Saved</span>
					)}
				</div>
			</div>
		</Section>
	);
}

function EmailSection({ currentEmail }: { currentEmail: string }) {
	const [newEmail, setNewEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [sent, setSent] = useState(false);

	const change = async () => {
		if (!newEmail.trim() || newEmail === currentEmail) return;
		setLoading(true);
		setError("");
		const { error: err } = await authClient.changeEmail({
			newEmail: newEmail.trim(),
			callbackURL: "/settings",
		});
		setLoading(false);
		if (err) {
			setError(err.message ?? "Failed to send verification email");
		} else {
			setSent(true);
			setNewEmail("");
		}
	};

	return (
		<Section
			title="Email address"
			description="A verification link will be sent to the new address."
		>
			{sent ? (
				<div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-800 dark:border-green-700 dark:bg-green-950/30 dark:text-green-300">
					Verification email sent. Check your inbox and click the link to confirm the change.
				</div>
			) : (
				<div className="space-y-4">
					<div>
						<label htmlFor="new-email" className={labelCls}>
							New email address
						</label>
						<input
							id="new-email"
							type="email"
							className={inputCls}
							value={newEmail}
							placeholder={currentEmail}
							onChange={(e) => setNewEmail(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && change()}
						/>
					</div>
					{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
					<Button
						disabled={loading || !newEmail.trim() || newEmail === currentEmail}
						onClick={change}
					>
						{loading ? "Sending…" : "Update email"}
					</Button>
				</div>
			)}
		</Section>
	);
}

function PasswordSection() {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState(false);

	const save = async () => {
		if (!current || !next || next !== confirm) return;
		if (next.length < 8) { setError("Password must be at least 8 characters"); return; }
		setLoading(true);
		setError("");
		const { error: err } = await authClient.changePassword({
			currentPassword: current,
			newPassword: next,
			revokeOtherSessions: false,
		});
		setLoading(false);
		if (err) {
			setError(err.message ?? "Failed to change password");
		} else {
			setCurrent(""); setNext(""); setConfirm("");
			setSuccess(true);
			setTimeout(() => setSuccess(false), 2500);
		}
	};

	const mismatch = confirm && next !== confirm;

	return (
		<Section title="Password" description="Must be at least 8 characters.">
			<div className="space-y-4">
				<div>
					<label htmlFor="current-pw" className={labelCls}>Current password</label>
					<input
						id="current-pw"
						type="password"
						className={inputCls}
						value={current}
						autoComplete="current-password"
						onChange={(e) => setCurrent(e.target.value)}
					/>
				</div>
				<div>
					<label htmlFor="new-pw" className={labelCls}>New password</label>
					<input
						id="new-pw"
						type="password"
						className={inputCls}
						value={next}
						autoComplete="new-password"
						onChange={(e) => setNext(e.target.value)}
					/>
				</div>
				<div>
					<label htmlFor="confirm-pw" className={labelCls}>Confirm new password</label>
					<input
						id="confirm-pw"
						type="password"
						className={`${inputCls} ${mismatch ? "border-red-400 focus:ring-red-400" : ""}`}
						value={confirm}
						autoComplete="new-password"
						onChange={(e) => setConfirm(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && save()}
					/>
					{mismatch && (
						<p className="mt-1 text-xs text-red-600 dark:text-red-400">Passwords don't match</p>
					)}
				</div>
				{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
				<div className="flex items-center gap-3">
					<Button
						disabled={loading || !current || !next || next !== confirm || next.length < 8}
						onClick={save}
					>
						{loading ? "Saving…" : "Change password"}
					</Button>
					{success && (
						<span className="text-sm text-green-600 dark:text-green-400">Password updated</span>
					)}
				</div>
			</div>
		</Section>
	);
}

function SettingsPage() {
	const { data: session } = useQuery(authSessionQueryOptions());
	const user = session?.user;

	if (!user) return null;

	return (
		<div className="page-wrap px-4 py-10">
			<div className="mx-auto max-w-2xl space-y-6">
				<h1 className="text-2xl font-bold text-[var(--sea-ink)]">Account settings</h1>
				<ProfileSection name={user.name} email={user.email} />
				<EmailSection currentEmail={user.email} />
				<PasswordSection />
			</div>
		</div>
	);
}
