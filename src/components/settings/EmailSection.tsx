import { useState } from "react";
import { Section } from "@/components/Section";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { authClient } from "@/lib/auth-client";

export function EmailSection({ currentEmail }: { currentEmail: string }) {
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
					Verification email sent. Check your inbox and click the link to
					confirm the change.
				</div>
			) : (
				<div className="space-y-4">
					<FormField label="New email address" htmlFor="new-email">
						<Input
							id="new-email"
							type="email"
							value={newEmail}
							placeholder={currentEmail}
							onChange={(e) => setNewEmail(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && change()}
						/>
					</FormField>
					{error && (
						<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
					)}
					<LoadingButton
						isLoading={loading}
						loadingLabel="Sending…"
						disabled={!newEmail.trim() || newEmail === currentEmail}
						onClick={change}
					>
						Update email
					</LoadingButton>
				</div>
			)}
		</Section>
	);
}
