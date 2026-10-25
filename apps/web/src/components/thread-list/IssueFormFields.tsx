import { lazy, Suspense } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_BODY_CHARS } from "@/lib/limits";
import type { IssueFormElement } from "@/lib/repository-templates";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

export function IssueFormFields({
	elements,
}: {
	elements: IssueFormElement[];
}) {
	return elements.map((element, index) => {
		const field = `field-${index}`,
			description = `${field}-description`;
		const { attributes, validations } = element;
		if (element.type === "markdown")
			return (
				<Suspense key={field} fallback={<p>{attributes.value}</p>}>
					<MarkdownRenderer content={attributes.value ?? ""} />
				</Suspense>
			);
		if (element.type === "checkboxes")
			return (
				<fieldset key={field} className="space-y-2">
					<legend className="text-sm font-medium">{attributes.label}</legend>
					{attributes.description && (
						<p className="text-sm text-bjork-text-muted">
							{attributes.description}
						</p>
					)}
					{attributes.options?.map((option, optionIndex) => (
						<label
							key={typeof option === "string" ? option : option.label}
							className="flex items-center gap-2 text-sm"
						>
							<input
								type="checkbox"
								name={field}
								value={optionIndex}
								required={typeof option !== "string" && option.required}
							/>
							{typeof option === "string" ? option : option.label}
							{typeof option !== "string" && option.required
								? " (required)"
								: ""}
						</label>
					))}
				</fieldset>
			);
		const common = {
			id: field,
			name: field,
			required: validations?.required,
			"aria-describedby": attributes.description ? description : undefined,
		};
		const defaults =
			attributes.default === undefined
				? []
				: Array.isArray(attributes.default)
					? attributes.default
					: [attributes.default];
		const defaultValues = defaults
			.map((i) => attributes.options?.[i])
			.filter((option): option is string => typeof option === "string");
		return (
			<div key={field} className="space-y-1.5">
				<Label htmlFor={field}>
					{attributes.label}
					{validations?.required ? " (required)" : ""}
				</Label>
				{attributes.description && (
					<p id={description} className="text-sm text-bjork-text-muted">
						{attributes.description}
					</p>
				)}
				{element.type === "input" ? (
					<Input
						{...common}
						defaultValue={attributes.value}
						placeholder={attributes.placeholder}
						minLength={validations?.min_length}
						maxLength={MAX_BODY_CHARS}
					/>
				) : element.type === "textarea" ? (
					<Textarea
						{...common}
						defaultValue={attributes.value}
						placeholder={attributes.placeholder}
						rows={5}
						minLength={validations?.min_length}
						maxLength={MAX_BODY_CHARS}
					/>
				) : (
					<select
						{...common}
						multiple={attributes.multiple}
						defaultValue={
							attributes.multiple ? defaultValues : (defaultValues[0] ?? "")
						}
						className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					>
						{!attributes.multiple && <option value="">Select an option</option>}
						{attributes.options?.map((option) =>
							typeof option === "string" ? (
								<option key={option} value={option}>
									{option}
								</option>
							) : null,
						)}
					</select>
				)}
			</div>
		);
	});
}
