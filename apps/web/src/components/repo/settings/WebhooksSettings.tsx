import { inputs } from "@pushstack/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	queryKeys,
	repoWebhookDeliveriesQueryOptions,
	repoWebhooksQueryOptions,
} from "@/lib/query-options";
import {
	deleteRepoWebhook,
	pingRepoWebhook,
	redeliverRepoWebhookDelivery,
	saveRepoWebhook,
	type WebhookDeliverySettings,
} from "@/server/webhooks";

type WebhookEventName = (typeof inputs.WEBHOOK_EVENT_NAMES)[number];

interface Draft {
	hookId: number | null;
	url: string;
	contentType: "json" | "form";
	/** `undefined` keeps the stored secret; null removes it. */
	secret?: string | null;
	events: WebhookEventName[];
	active: boolean;
	removeSecret: boolean;
}

const EMPTY_DRAFT: Draft = {
	hookId: null,
	url: "",
	contentType: "json",
	secret: undefined,
	events: ["push"],
	active: true,
	removeSecret: false,
};

/** The payload bytes as inert text; a `<script>` in one stays text. */
function Payload({ label, value }: { label: string; value: string | null }) {
	if (value === null) {
		return (
			<p className="text-xs text-muted-foreground">{label}: not retained</p>
		);
	}
	return (
		<div className="space-y-1">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">
				{value}
			</pre>
		</div>
	);
}

function Deliveries({ repoId, hookId }: { repoId: number; hookId: number }) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState<number | null>(null);
	const [error, setError] = useState("");
	const { data, isLoading } = useQuery(
		repoWebhookDeliveriesQueryOptions(repoId, hookId),
	);

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.repoWebhookDeliveries(repoId, hookId),
		});

	const redeliver = useMutation({
		mutationFn: redeliverRepoWebhookDelivery,
		onSuccess: () => {
			setError("");
			refresh();
		},
		onError: (e: Error) => setError(e.message),
	});

	if (isLoading) {
		return <div className="h-11 animate-pulse rounded-lg bg-muted" />;
	}
	if (!data || data.deliveries.length === 0) {
		return <p className="text-sm text-muted-foreground">No deliveries yet.</p>;
	}
	return (
		<div className="space-y-2">
			<FieldError>{error}</FieldError>
			<ul className="divide-y divide-[var(--border)] rounded-lg border border-border">
				{data.deliveries.map((delivery: WebhookDeliverySettings) => (
					<li key={delivery.id} className="px-3 py-2.5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<button
								type="button"
								className="text-left text-sm hover:text-bjork-accent"
								onClick={() =>
									setOpen((current) =>
										current === delivery.id ? null : delivery.id,
									)
								}
							>
								<span className="font-medium">
									{delivery.event}
									{delivery.action ? ` · ${delivery.action}` : ""}
								</span>
								<span className="ml-2 text-xs text-muted-foreground">
									{delivery.statusCode ?? "no response"} · {delivery.duration}ms
									{delivery.redelivery ? " · redelivery" : ""}
								</span>
							</button>
							<Button
								variant="outline"
								disabled={redeliver.isPending}
								onClick={() =>
									redeliver.mutate({
										data: { repoId, hookId, deliveryId: delivery.id },
									})
								}
							>
								Redeliver
							</Button>
						</div>
						{open === delivery.id ? (
							<div className="mt-2 space-y-2">
								<Payload label="Request" value={delivery.requestPayload} />
								<Payload label="Response" value={delivery.responsePayload} />
							</div>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}

export function WebhooksSettings({ repoId }: { repoId: number }) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [openDeliveries, setOpenDeliveries] = useState<number | null>(null);
	const [error, setError] = useState("");
	const { data: hooks = [], isLoading } = useQuery(
		repoWebhooksQueryOptions(repoId),
	);

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.repoWebhooks(repoId),
		});

	const save = useMutation({
		mutationFn: saveRepoWebhook,
		onSuccess: () => {
			setDraft(null);
			setError("");
			refresh();
		},
		onError: (e: Error) => setError(e.message),
	});

	const remove = useMutation({
		mutationFn: deleteRepoWebhook,
		onSuccess: () => {
			setError("");
			refresh();
		},
		onError: (e: Error) => setError(e.message),
	});

	const ping = useMutation({
		mutationFn: pingRepoWebhook,
		onSuccess: (_data, variables) => {
			setError("");
			queryClient.invalidateQueries({
				queryKey: queryKeys.repoWebhookDeliveries(
					repoId,
					variables.data.hookId,
				),
			});
		},
		onError: (e: Error) => setError(e.message),
	});

	const update = (patch: Partial<Draft>) =>
		setDraft((current) => (current ? { ...current, ...patch } : current));

	const toggleEvent = (event: WebhookEventName, checked: boolean) => {
		if (!draft) return;
		update({
			events: checked
				? [...draft.events, event]
				: draft.events.filter((name) => name !== event),
		});
	};

	return (
		<Section
			title="Webhooks"
			description="Deliveries to an HTTPS URL for pushes, issues and pull requests. Every attempt is recorded and can be redelivered."
		>
			<div className="space-y-4">
				<FieldError>{error}</FieldError>
				{isLoading ? (
					<div className="h-11 animate-pulse rounded-lg border border-border bg-muted" />
				) : hooks.length > 0 ? (
					<ul className="divide-y divide-[var(--border)] rounded-lg border border-border">
						{hooks.map((hook) => (
							<li key={hook.id} className="space-y-2 px-4 py-3.5">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="min-w-0">
										<code className="break-all text-sm font-medium text-foreground">
											{hook.url}
										</code>
										<p className="mt-0.5 text-xs text-muted-foreground">
											{hook.events.join(", ")} ·{" "}
											{hook.lastResponse.code ?? "no response"}
											{hook.lastResponse.status
												? ` ${hook.lastResponse.status}`
												: ""}
											{hook.active ? "" : " · inactive"}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										<Switch
											aria-label="Active"
											checked={hook.active}
											onClick={() =>
												save.mutate({
													data: {
														repoId,
														hookId: hook.id,
														url: hook.url,
														contentType: hook.contentType,
														events: hook.events as WebhookEventName[],
														active: !hook.active,
													},
												})
											}
										/>
										<Button
											variant="outline"
											onClick={() => {
												setDraft({
													hookId: hook.id,
													url: hook.url,
													contentType: hook.contentType,
													secret: undefined,
													events: hook.events as WebhookEventName[],
													active: hook.active,
													removeSecret: false,
												});
												setError("");
											}}
										>
											Edit
										</Button>
										<Button
											variant="outline"
											disabled={ping.isPending}
											onClick={() =>
												ping.mutate({ data: { repoId, hookId: hook.id } })
											}
										>
											Ping
										</Button>
										<Button
											variant="outline"
											onClick={() =>
												setOpenDeliveries((current) =>
													current === hook.id ? null : hook.id,
												)
											}
										>
											Deliveries
										</Button>
										<Button
											variant="outline"
											disabled={remove.isPending}
											onClick={() =>
												remove.mutate({ data: { repoId, hookId: hook.id } })
											}
										>
											Delete
										</Button>
									</div>
								</div>
								{openDeliveries === hook.id ? (
									<Deliveries repoId={repoId} hookId={hook.id} />
								) : null}
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">No webhooks yet.</p>
				)}

				{draft ? (
					<div className="space-y-4 rounded-lg border border-border p-4">
						<FormField
							label="Payload URL"
							htmlFor="hook-url"
							hint="(an https URL)"
						>
							<Input
								id="hook-url"
								value={draft.url}
								placeholder="https://example.com/hook"
								onChange={(e) => update({ url: e.target.value })}
							/>
						</FormField>

						<FormField label="Content type" htmlFor="hook-content-type">
							<select
								id="hook-content-type"
								className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
								value={draft.contentType}
								onChange={(e) =>
									update({
										contentType: e.target.value as "json" | "form",
									})
								}
							>
								<option value="json">application/json</option>
								<option value="form">application/x-www-form-urlencoded</option>
							</select>
						</FormField>

						<FormField
							label="Secret"
							htmlFor="hook-secret"
							hint={
								draft.hookId === null
									? "(optional, used to sign deliveries)"
									: "(blank keeps the stored secret)"
							}
						>
							<Input
								id="hook-secret"
								type="password"
								autoComplete="new-password"
								value={draft.secret ?? ""}
								onChange={(e) =>
									update({
										secret: e.target.value === "" ? undefined : e.target.value,
										removeSecret: false,
									})
								}
							/>
						</FormField>
						{draft.hookId !== null ? (
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={draft.removeSecret}
									onChange={(e) =>
										update({
											removeSecret: e.target.checked,
											secret: e.target.checked ? null : undefined,
										})
									}
								/>
								Remove the stored secret
							</label>
						) : null}

						<div className="space-y-1">
							<p className="text-sm font-medium">Events</p>
							<div className="grid max-h-64 grid-cols-2 gap-1 overflow-auto rounded-lg border border-border p-3 text-sm sm:grid-cols-3">
								{inputs.WEBHOOK_EVENT_NAMES.map((event) => (
									<label key={event} className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={draft.events.includes(event)}
											onChange={(e) => toggleEvent(event, e.target.checked)}
										/>
										{event}
									</label>
								))}
							</div>
						</div>

						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={draft.active}
								onChange={(e) => update({ active: e.target.checked })}
							/>
							Active
						</label>

						<div className="flex items-center gap-2">
							<Button
								disabled={save.isPending}
								onClick={() =>
									save.mutate({
										data: {
											repoId,
											hookId: draft.hookId,
											url: draft.url,
											contentType: draft.contentType,
											events: draft.events,
											active: draft.active,
											...(draft.hookId === null
												? {
														secret:
															typeof draft.secret === "string"
																? draft.secret
																: null,
													}
												: draft.secret !== undefined && {
														secret: draft.secret,
													}),
										},
									})
								}
							>
								{draft.hookId === null ? "Add webhook" : "Save"}
							</Button>
							<Button variant="outline" onClick={() => setDraft(null)}>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<Button onClick={() => setDraft(EMPTY_DRAFT)}>Add webhook</Button>
				)}
			</div>
		</Section>
	);
}
