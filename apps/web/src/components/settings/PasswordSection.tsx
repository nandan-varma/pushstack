import { useState } from "react";
import { Section } from "@/components/Section";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { authClient } from "@/lib/auth-client";

export function PasswordSection() {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState(false);

	const save = async () => {
		if (!current || !next || next !== confirm) return;
		if (next.length < 8) {
			setError("Password must be at least 8 characters");
			return;
		}
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
			setCurrent("");
			setNext("");
			setConfirm("");
			setSuccess(true);
			setTimeout(() => setSuccess(false), 2500);
		}
	};

	const mismatch = confirm && next !== confirm;

	return (
		<Section title="Password" description="Must be at least 8 characters.">
			<div className="space-y-4">
				<FormField label="Current password" htmlFor="current-pw">
					<Input
						id="current-pw"
						type="password"
						value={current}
						autoComplete="current-password"
						onChange={(e) => setCurrent(e.target.value)}
					/>
				</FormField>
				<FormField label="New password" htmlFor="new-pw">
					<Input
						id="new-pw"
						type="password"
						value={next}
						autoComplete="new-password"
						onChange={(e) => setNext(e.target.value)}
					/>
				</FormField>
				<FormField label="Confirm new password" htmlFor="confirm-pw">
					<Input
						id="confirm-pw"
						type="password"
						value={confirm}
						autoComplete="new-password"
						className={mismatch ? "border-red-400 focus:ring-red-400" : ""}
						onChange={(e) => setConfirm(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && save()}
					/>
					{mismatch && (
						<p className="mt-1 text-xs text-red-600 dark:text-red-400">
							Passwords don't match
						</p>
					)}
				</FormField>
				{error && (
					<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
				)}
				<div className="flex items-center gap-3">
					<LoadingButton
						isLoading={loading}
						loadingLabel="Saving…"
						disabled={!current || !next || next !== confirm || next.length < 8}
						onClick={save}
					>
						Change password
					</LoadingButton>
					{success && (
						<span className="text-sm text-green-600 dark:text-green-400">
							Password updated
						</span>
					)}
				</div>
			</div>
		</Section>
	);
}
