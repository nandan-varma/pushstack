import { useState } from "react";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
					<div className="space-y-1.5">
						<Label htmlFor="new-email">New email address</Label>
						<Input
							id="new-email"
							type="email"
							value={newEmail}
							placeholder={currentEmail}
							onChange={(e) => setNewEmail(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && change()}
						/>
					</div>
					{error && (
						<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
					)}
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
