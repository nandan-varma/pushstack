import { useState } from "react";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
				<div className="space-y-1.5">
					<Label htmlFor="current-pw">Current password</Label>
					<Input
						id="current-pw"
						type="password"
						value={current}
						autoComplete="current-password"
						onChange={(e) => setCurrent(e.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="new-pw">New password</Label>
					<Input
						id="new-pw"
						type="password"
						value={next}
						autoComplete="new-password"
						onChange={(e) => setNext(e.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="confirm-pw">Confirm new password</Label>
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
				</div>
				{error && (
					<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
				)}
				<div className="flex items-center gap-3">
					<Button
						disabled={
							loading ||
							!current ||
							!next ||
							next !== confirm ||
							next.length < 8
						}
						onClick={save}
					>
						{loading ? "Saving…" : "Change password"}
					</Button>
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
