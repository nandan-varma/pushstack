import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	MAX_PROJECT_FIELD_NAME_CHARS,
	MAX_PROJECT_FIELDS,
	MAX_PROJECT_OPTION_NAME_CHARS,
} from "@/lib/limits";
import { queryKeys } from "@/lib/query-options";
import type { ProjectField } from "@/server/projects";
import {
	createUserProjectField,
	updateUserProjectField,
} from "@/server/projects";

const FIELD_TYPES = [
	{ value: "TEXT", label: "Text" },
	{ value: "NUMBER", label: "Number" },
	{ value: "DATE", label: "Date" },
	{ value: "SINGLE_SELECT", label: "Single select" },
] as const;

/**
 * The project's field management: adds a field (with options for a
 * single-select one), renames a field and appends options. Renaming sends the
 * full options list with their ids, so values already set survive.
 */
export function ProjectFieldEditor({
	login,
	number,
	fields,
}: {
	login: string;
	number: number;
	fields: ProjectField[];
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.userProjectRoot(login, number),
		});
	const createField = useMutation({
		mutationFn: createUserProjectField,
		onSuccess: () => {
			setNewName("");
			setNewType("TEXT");
			setNewOptions([]);
			invalidate();
		},
		onError: (error: Error) =>
			toast(error.message || "Couldn't create the field", "error"),
	});
	const updateField = useMutation({
		mutationFn: updateUserProjectField,
		onSuccess: invalidate,
		onError: (error: Error) =>
			toast(error.message || "Couldn't update the field", "error"),
	});

	const [newName, setNewName] = useState("");
	const [newType, setNewType] =
		useState<(typeof FIELD_TYPES)[number]["value"]>("TEXT");
	const [newOptions, setNewOptions] = useState<string[]>([]);
	const [newOptionDraft, setNewOptionDraft] = useState("");
	const [optionDrafts, setOptionDrafts] = useState<Record<number, string>>({});

	return (
		<section
			aria-label="Field management"
			className="space-y-4 rounded-[18px] border border-bjork-border-muted bg-bjork-surface p-5"
		>
			<ol className="space-y-2">
				{fields.map((field) => (
					<li
						key={field.id}
						className="flex flex-wrap items-center gap-2 text-sm"
					>
						<Badge variant="outline">
							{FIELD_TYPES.find((type) => type.value === field.dataType)
								?.label ?? field.dataType}
						</Badge>
						<FieldNameEditor
							field={field}
							pending={updateField.isPending}
							onSave={(name) =>
								updateField.mutate({
									data: { login, number, fieldId: field.id, name },
								})
							}
						/>
						{field.dataType === "SINGLE_SELECT" && (
							<span className="flex flex-wrap items-center gap-1.5">
								{field.options.map((option) => (
									<Badge key={option.id} variant="secondary">
										{option.name}
									</Badge>
								))}
								<form
									className="flex items-center gap-1.5"
									onSubmit={(event) => {
										event.preventDefault();
										const name = (optionDrafts[field.id] ?? "").trim();
										if (!name) return;
										updateField.mutate({
											data: {
												login,
												number,
												fieldId: field.id,
												options: [
													...field.options.map((option) => ({
														id: option.id,
														name: option.name,
													})),
													{ name },
												],
											},
										});
										setOptionDrafts((drafts) => ({
											...drafts,
											[field.id]: "",
										}));
									}}
								>
									<Input
										aria-label={`Add an option to ${field.name}`}
										className="h-8 w-36"
										value={optionDrafts[field.id] ?? ""}
										maxLength={MAX_PROJECT_OPTION_NAME_CHARS}
										placeholder="Add option"
										onChange={(event) =>
											setOptionDrafts((drafts) => ({
												...drafts,
												[field.id]: event.target.value,
											}))
										}
									/>
									<LoadingButton
										type="submit"
										size="sm"
										aria-label={`Add option to ${field.name}`}
										isLoading={updateField.isPending}
										disabled={!(optionDrafts[field.id] ?? "").trim()}
									>
										<Plus aria-hidden="true" />
									</LoadingButton>
								</form>
							</span>
						)}
					</li>
				))}
			</ol>

			<form
				aria-label="New field"
				className="flex flex-wrap items-end gap-2 border-t border-bjork-border-muted pt-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (!newName.trim()) return;
					createField.mutate({
						data: {
							login,
							number,
							name: newName,
							dataType: newType,
							options:
								newType === "SINGLE_SELECT" && newOptions.length > 0
									? newOptions.map((name) => ({ name }))
									: undefined,
						},
					});
				}}
			>
				<div className="space-y-1.5">
					<Label htmlFor="new-project-field-name">Field name</Label>
					<Input
						id="new-project-field-name"
						className="w-44"
						value={newName}
						maxLength={MAX_PROJECT_FIELD_NAME_CHARS}
						placeholder="Priority"
						onChange={(event) => setNewName(event.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="new-project-field-type">Type</Label>
					<Select
						value={newType}
						onValueChange={(value) =>
							setNewType(value as (typeof FIELD_TYPES)[number]["value"])
						}
					>
						<SelectTrigger id="new-project-field-type" className="w-36">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{FIELD_TYPES.map((type) => (
								<SelectItem key={type.value} value={type.value}>
									{type.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{newType === "SINGLE_SELECT" && (
					<div className="space-y-1.5">
						<Label htmlFor="new-project-field-option">Options</Label>
						<div className="flex w-56 flex-wrap items-center gap-1.5">
							{newOptions.map((option, index) => (
								<Badge key={option} variant="secondary">
									{option}
									<button
										type="button"
										aria-label={`Remove option ${option}`}
										className="ml-1 inline-flex"
										onClick={() =>
											setNewOptions((options) =>
												options.filter((_, at) => at !== index),
											)
										}
									>
										<X aria-hidden="true" className="size-3" />
									</button>
								</Badge>
							))}
							<Input
								id="new-project-field-option"
								className="h-8 w-28"
								value={newOptionDraft}
								maxLength={MAX_PROJECT_OPTION_NAME_CHARS}
								placeholder="Option"
								onChange={(event) => setNewOptionDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== "Enter" || !newOptionDraft.trim()) return;
									event.preventDefault();
									setNewOptions((options) => [
										...options,
										newOptionDraft.trim(),
									]);
									setNewOptionDraft("");
								}}
							/>
						</div>
					</div>
				)}
				<LoadingButton
					type="submit"
					isLoading={createField.isPending}
					disabled={
						!newName.trim() ||
						fields.length >= MAX_PROJECT_FIELDS ||
						(newType === "SINGLE_SELECT" && newOptions.length === 0)
					}
				>
					Add field
				</LoadingButton>
			</form>
		</section>
	);
}

function FieldNameEditor({
	field,
	pending,
	onSave,
}: {
	field: ProjectField;
	pending: boolean;
	onSave: (name: string) => void;
}) {
	const [name, setName] = useState(field.name);
	const [editing, setEditing] = useState(false);
	const dirty = name.trim() !== field.name && name.trim() !== "";

	if (!editing) {
		return (
			<button
				type="button"
				className="font-medium text-bjork-text hover:text-bjork-accent"
				onClick={() => setEditing(true)}
			>
				{field.name}
			</button>
		);
	}
	return (
		<span className="flex items-center gap-1.5">
			<Input
				aria-label={`Rename ${field.name}`}
				className="h-8 w-36"
				value={name}
				maxLength={MAX_PROJECT_FIELD_NAME_CHARS}
				onChange={(event) => setName(event.target.value)}
			/>
			<Button
				size="sm"
				disabled={pending || !dirty}
				onClick={() => {
					onSave(name.trim());
					setEditing(false);
				}}
			>
				Save
			</Button>
			<Button
				size="sm"
				variant="ghost"
				onClick={() => {
					setName(field.name);
					setEditing(false);
				}}
			>
				Cancel
			</Button>
		</span>
	);
}
