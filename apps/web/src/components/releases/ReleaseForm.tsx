import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";
import { formatFileSize } from "@/lib/language-detection";
import {
	MAX_BODY_CHARS,
	MAX_RELEASE_ASSET_BYTES,
	MAX_RELEASE_NAME_CHARS,
	MAX_RELEASE_TAG_CHARS,
} from "@/lib/limits";
import { queryKeys } from "@/lib/query-options";
import {
	createReleaseFn,
	deleteReleaseAssetFn,
	generateReleaseNotesFn,
	updateReleaseFn,
} from "@/server/releases";
import { uploadReleaseAsset } from "./upload-assets";

export interface ReleaseFormInitial {
	id: number;
	tagName: string;
	targetCommitish: string;
	name: string;
	body: string;
	draft: boolean;
	prerelease: boolean;
	isLatest: boolean;
	assets: { id: number; name: string; size: number }[];
}

/** Create or edit a release; chosen files are attached after it is saved. */
export function ReleaseForm({
	owner,
	name,
	repoId,
	defaultBranch,
	initial,
}: {
	owner: string;
	name: string;
	repoId: number;
	defaultBranch: string;
	initial?: ReleaseFormInitial;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const fileInput = useRef<HTMLInputElement>(null);
	const [tagName, setTagName] = useState(initial?.tagName ?? "");
	const [target, setTarget] = useState(
		initial?.targetCommitish ?? defaultBranch,
	);
	const [title, setTitle] = useState(initial?.name ?? "");
	const [body, setBody] = useState(initial?.body ?? "");
	const [prerelease, setPrerelease] = useState(initial?.prerelease ?? false);
	const [makeLatest, setMakeLatest] = useState(initial?.isLatest ?? true);
	const [files, setFiles] = useState<File[]>([]);
	const [removed, setRemoved] = useState<number[]>([]);
	const [progress, setProgress] = useState<string | null>(null);

	const notes = useMutation({
		mutationFn: generateReleaseNotesFn,
		onSuccess: (generated) => {
			setBody((current) =>
				current.trim() ? `${current}\n\n${generated.body}` : generated.body,
			);
			setTitle((current) => current || generated.name);
		},
		onError: (err: Error) => toast(err.message, "error"),
	});

	const save = useMutation({
		mutationFn: async (draft: boolean) => {
			const fields = {
				repoId,
				tagName: tagName.trim(),
				targetCommitish: target.trim() || defaultBranch,
				name: title,
				body,
				draft,
				prerelease,
				makeLatest: makeLatest && !prerelease && !draft,
			};
			const saved = initial
				? await updateReleaseFn({ data: { ...fields, releaseId: initial.id } })
				: await createReleaseFn({ data: fields });
			for (const assetId of removed) {
				await deleteReleaseAssetFn({ data: { repoId, assetId } });
			}
			for (const [index, file] of files.entries()) {
				setProgress(`Uploading ${file.name} (${index + 1}/${files.length})`);
				await uploadReleaseAsset(repoId, saved.id, file);
			}
			return { saved, draft };
		},
		onSuccess: async ({ saved }) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.repoReleasesRoot(repoId),
			});
			await navigate({
				to: "/$owner/$name/releases/tag/$",
				params: { owner, name, _splat: saved.tagName },
			});
		},
		onError: (err: Error) => {
			setProgress(null);
			toast(err.message, "error");
		},
	});

	const tooBig = files.find((file) => file.size > MAX_RELEASE_ASSET_BYTES);
	const ready = tagName.trim() !== "" && !tooBig && !save.isPending;
	const isDraftRelease = initial?.draft ?? false;

	return (
		<form
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (ready) save.mutate(false);
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label htmlFor="release-tag">Tag</Label>
					<Input
						id="release-tag"
						value={tagName}
						maxLength={MAX_RELEASE_TAG_CHARS}
						onChange={(e) => setTagName(e.target.value)}
						placeholder="v1.0.0"
						className="h-10 font-mono"
					/>
					<p className="text-xs text-bjork-text-soft">
						A missing tag is created from the target when the release is
						published.
					</p>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="release-target">Target</Label>
					<Input
						id="release-target"
						value={target}
						onChange={(e) => setTarget(e.target.value)}
						placeholder={defaultBranch}
						className="h-10 font-mono"
					/>
					<p className="text-xs text-bjork-text-soft">
						A branch name or a full commit SHA.
					</p>
				</div>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="release-title">Release title</Label>
				<Input
					id="release-title"
					value={title}
					maxLength={MAX_RELEASE_NAME_CHARS}
					onChange={(e) => setTitle(e.target.value)}
					placeholder={tagName || "Release title"}
					className="h-10"
				/>
			</div>
			<div className="space-y-1.5">
				<div className="flex items-center justify-between">
					<Label htmlFor="release-body">Release notes</Label>
					<LoadingButton
						type="button"
						variant="outline"
						isLoading={notes.isPending}
						loadingLabel="Generating…"
						disabled={!tagName.trim()}
						onClick={() =>
							notes.mutate({
								data: {
									repoId,
									tagName: tagName.trim(),
									targetCommitish: target.trim() || undefined,
								},
							})
						}
					>
						Generate release notes
					</LoadingButton>
				</div>
				<Textarea
					id="release-body"
					value={body}
					maxLength={MAX_BODY_CHARS}
					onChange={(e) => setBody(e.target.value)}
					rows={10}
					placeholder="Describe this release (Markdown)"
					className="min-h-48"
				/>
			</div>
			<div className="space-y-2">
				<Label>Files</Label>
				<ul className="space-y-1 text-sm">
					{initial?.assets
						.filter((asset) => !removed.includes(asset.id))
						.map((asset) => (
							<li key={asset.id} className="flex items-center gap-3">
								<span className="min-w-0 flex-1 truncate">{asset.name}</span>
								<span className="font-mono text-xs text-bjork-text-soft">
									{formatFileSize(asset.size)}
								</span>
								<Button
									type="button"
									variant="outline"
									onClick={() => setRemoved([...removed, asset.id])}
								>
									Remove
								</Button>
							</li>
						))}
					{files.map((file, index) => (
						<li
							key={`${file.name}-${file.size}-${file.lastModified}`}
							className="flex items-center gap-3"
						>
							<span className="min-w-0 flex-1 truncate">{file.name}</span>
							<span className="font-mono text-xs text-bjork-text-soft">
								{formatFileSize(file.size)}
							</span>
							<Button
								type="button"
								variant="outline"
								onClick={() => setFiles(files.filter((_, i) => i !== index))}
							>
								Remove
							</Button>
						</li>
					))}
				</ul>
				<input
					ref={fileInput}
					type="file"
					multiple
					hidden
					onChange={(event) => {
						setFiles([...files, ...Array.from(event.target.files ?? [])]);
						event.target.value = "";
					}}
				/>
				<Button
					type="button"
					variant="outline"
					onClick={() => fileInput.current?.click()}
				>
					Attach files
				</Button>
				{tooBig && (
					<p className="text-sm text-destructive">
						{tooBig.name} is over {formatFileSize(MAX_RELEASE_ASSET_BYTES)}.
					</p>
				)}
			</div>
			<div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={prerelease}
						onChange={(e) => setPrerelease(e.target.checked)}
					/>
					This is a pre-release
				</label>
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={makeLatest && !prerelease}
						disabled={prerelease}
						onChange={(e) => setMakeLatest(e.target.checked)}
					/>
					Set as the latest release
				</label>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<LoadingButton
					type="submit"
					isLoading={save.isPending && !save.variables}
					loadingLabel={progress ?? "Publishing…"}
					disabled={!ready}
				>
					{initial && !isDraftRelease ? "Update release" : "Publish release"}
				</LoadingButton>
				{(!initial || isDraftRelease) && (
					<LoadingButton
						type="button"
						variant="outline"
						isLoading={save.isPending && save.variables === true}
						loadingLabel={progress ?? "Saving…"}
						disabled={!ready}
						onClick={() => save.mutate(true)}
					>
						Save draft
					</LoadingButton>
				)}
			</div>
		</form>
	);
}
