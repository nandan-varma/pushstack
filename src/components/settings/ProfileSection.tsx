import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Section } from "@/components/Section";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { authClient } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query-options";

export function ProfileSection({
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
		const { error: err } = await authClient.updateUser({
			name: displayName.trim(),
		});
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
				<FormField label="Display name" htmlFor="display-name">
					<Input
						id="display-name"
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && save()}
					/>
				</FormField>
				<FormField label="Email" htmlFor="email">
					<Input id="email" value={email} disabled className="opacity-60" />
					<p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
						Change your email in the Email section below.
					</p>
				</FormField>
				{error && (
					<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
				)}
				<div className="flex items-center gap-3">
					<LoadingButton
						isLoading={loading}
						loadingLabel="Saving…"
						disabled={!displayName.trim() || displayName === name}
						onClick={save}
					>
						Save
					</LoadingButton>
					{success && (
						<span className="text-sm text-green-600 dark:text-green-400">
							Saved
						</span>
					)}
				</div>
			</div>
		</Section>
	);
}
