import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { accessTokensQueryOptions, queryKeys } from "@/lib/query-options";
import {
	TOKEN_SCOPE_LABELS,
	TOKEN_SCOPES,
	type TokenScope,
} from "@/lib/token-scopes";
import { createToken, revokeToken } from "@/server/tokens";

const LIFETIMES = [
	{ value: "7", label: "7 days", days: 7 },
	{ value: "30", label: "30 days", days: 30 },
	{ value: "90", label: "90 days", days: 90 },
	{ value: "365", label: "1 year", days: 365 },
	{ value: "never", label: "No expiration", days: null },
] as const;
type Lifetime = (typeof LIFETIMES)[number]["value"];

function relative(date: Date | string | null): string {
	return date ? formatDistanceToNow(new Date(date), { addSuffix: true }) : "";
}

export function AccessTokensSection() {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [scope, setScope] = useState<TokenScope>("repo:write");
	const [lifetime, setLifetime] = useState<Lifetime>("90");
	const [created, setCreated] = useState<string | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);
	const { copied, copy: copyToClipboard } = useCopyToClipboard();

	const { data: tokens = [], isLoading } = useQuery(accessTokensQueryOptions());
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.accessTokens });

	const createMutation = useMutation({
		mutationFn: createToken,
		onSuccess: ({ token }) => {
			setCreated(token);
			setCopyFailed(false);
			setName("");
			invalidate();
		},
	});
	const revokeMutation = useMutation({
		mutationFn: revokeToken,
		onSuccess: invalidate,
	});

	const create = () => {
		if (!name.trim()) return;
		const days = LIFETIMES.find((l) => l.value === lifetime)?.days ?? null;
		createMutation.mutate({
			data: { name: name.trim(), scopes: [scope], lifetimeDays: days },
		});
	};

	const copy = async () => {
		if (!created) return;
		const ok = await copyToClipboard(created);
		if (!ok) setCopyFailed(true);
	};

	return (
		<Section
			id="tokens"
			title="Personal access tokens"
			description="Use a token instead of your password for git over HTTPS (git clone, fetch, push)."
		>
			<div className="space-y-4">
				{created && (
					<div className="space-y-2 rounded-lg border border-success-border bg-success-soft p-3">
						<p className="text-sm font-medium text-foreground">
							Copy your new token now — it won't be shown again.
						</p>
						<div className="flex gap-2">
							<Input
								readOnly
								value={created}
								className="font-mono text-xs"
								onFocus={(e) => e.currentTarget.select()}
							/>
							<Button variant="outline" onClick={copy}>
								{copied ? "Copied" : "Copy"}
							</Button>
						</div>
						{copyFailed && (
							<p className="text-xs text-muted-foreground">
								Couldn't copy automatically — select the token and copy it
								manually.
							</p>
						)}
					</div>
				)}

				{isLoading ? (
					<div className="h-11 animate-pulse rounded-lg border border-border bg-muted" />
				) : tokens.length > 0 ? (
					<ul className="divide-y divide-[var(--border)] rounded-lg border border-border">
						{tokens.map((t) => {
							const expired = t.expiresAt && new Date(t.expiresAt) < new Date();
							return (
								<li
									key={t.id}
									className="flex items-center justify-between gap-3 px-4 py-3.5"
								>
									<div className="min-w-0 space-y-0.5">
										<p className="truncate text-sm font-medium text-foreground">
											{t.name}
										</p>
										<p className="text-xs text-muted-foreground">
											{t.scopes.join(", ")} ·{" "}
											{t.lastUsedAt
												? `last used ${relative(t.lastUsedAt)}`
												: "never used"}{" "}
											·{" "}
											{t.expiresAt
												? expired
													? `expired ${relative(t.expiresAt)}`
													: `expires ${relative(t.expiresAt)}`
												: "no expiration"}
										</p>
									</div>
									<Button
										variant="outline"
										disabled={revokeMutation.isPending}
										onClick={() =>
											revokeMutation.mutate({ data: { id: t.id } })
										}
									>
										Revoke
									</Button>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">No tokens yet.</p>
				)}

				<div className="space-y-3">
					<FormField label="Token name" htmlFor="token-name">
						<Input
							id="token-name"
							placeholder="e.g. Laptop, CI"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && create()}
						/>
					</FormField>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Select
							value={scope}
							onValueChange={(value) => setScope(value as TokenScope)}
						>
							<SelectTrigger className="w-full sm:flex-1" aria-label="Access">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{TOKEN_SCOPES.map((s) => (
									<SelectItem key={s} value={s}>
										{TOKEN_SCOPE_LABELS[s]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Select
							value={lifetime}
							onValueChange={(value) => setLifetime(value as Lifetime)}
						>
							<SelectTrigger className="w-full sm:w-40" aria-label="Expiration">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{LIFETIMES.map((l) => (
									<SelectItem key={l.value} value={l.value}>
										{l.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<LoadingButton
							isLoading={createMutation.isPending}
							loadingLabel="Creating…"
							disabled={!name.trim()}
							onClick={create}
						>
							Create token
						</LoadingButton>
					</div>
					{createMutation.error && (
						<FieldError>{createMutation.error.message}</FieldError>
					)}
				</div>
			</div>
		</Section>
	);
}
