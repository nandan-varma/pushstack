import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	queryKeys,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { requireUserSession } from "@/lib/route-auth";
import { uploadFile } from "@/server/files";

export const Route = createFileRoute("/repo/$owner/$name/upload")({
	validateSearch: (search: Record<string, unknown>) => ({
		branch: (search.branch as string) || "",
	}),
	beforeLoad: async ({ context }) => {
		await requireUserSession(context.queryClient);
	},
	component: FileUploadPage,
});

function FileUploadPage() {
	const { owner, name } = Route.useParams();
	const { branch: searchBranch } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const [file, setFile] = useState<File | null>(null);
	const [path, setPath] = useState("");
	const [commitMessage, setCommitMessage] = useState("");
	const [branch, setBranch] = useState(searchBranch || "main");
	const [isDragging, setIsDragging] = useState(false);

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	const uploadMutation = useMutation({
		mutationFn: uploadFile,
		onSuccess: async () => {
			if (!repo) {
				return;
			}

			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.repositoryByName(owner, name),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoFilesRoot(repo.id),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoCommitsRoot(repo.id),
				}),
			]);
			navigate({
				to: "/repo/$owner/$name",
				params: { owner, name },
				search: { branch },
			});
		},
	});

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		if (e.dataTransfer.files[0]) {
			setFile(e.dataTransfer.files[0]);
			if (!path) {
				setPath(e.dataTransfer.files[0].name);
			}
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	};

	const handleDragLeave = () => {
		setIsDragging(false);
	};

	const openFilePicker = () => {
		document.getElementById("file-input")?.click();
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files?.[0]) {
			setFile(e.target.files[0]);
			if (!path) {
				setPath(e.target.files[0].name);
			}
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!file || !path || !commitMessage || !repo) return;

		const reader = new FileReader();
		reader.onload = async () => {
			const buffer = reader.result as ArrayBuffer;
			const bytes = new Uint8Array(buffer);
			let binary = "";
			for (const byte of bytes) {
				binary += String.fromCharCode(byte);
			}
			const base64 = window.btoa(binary);

			uploadMutation.mutate({
				data: {
					repoId: repo.id,
					branchName: branch,
					path,
					content: base64,
					commitMessage,
				},
			});
		};
		reader.readAsArrayBuffer(file);
	};

	return (
		<div className="mx-auto max-w-2xl">
			<div className="island-shell rounded-2xl p-8">
				<div className="mb-6">
					<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
						Upload file to {owner}/{name}
					</h2>
					<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
						Add a new file to the repository via web upload.
					</p>
				</div>
				<form onSubmit={handleSubmit} className="space-y-5">
					{/* Branch Selection */}
					<div className="space-y-1.5">
						<Label htmlFor="branch">Branch</Label>
						<select
							id="branch"
							value={branch}
							onChange={(e) => setBranch(e.target.value)}
							className="flex h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]/30"
						>
							{branches?.map((b) => (
								<option key={b.name} value={b.name}>
									{b.name}
								</option>
							))}
						</select>
					</div>

					{/* File Drop Zone */}
					<label
						htmlFor="file-input"
						className={`block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
							isDragging
								? "border-[var(--lagoon-deep)] bg-[rgba(79,184,178,0.06)]"
								: "border-[var(--line)] hover:border-[var(--lagoon-deep)]/50"
						}`}
						onDrop={handleDrop}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
					>
						{file ? (
							<div className="space-y-2">
								<p className="text-sm font-medium text-[var(--sea-ink)]">
									{file.name}
								</p>
								<p className="text-xs text-[var(--sea-ink-soft)]">
									{(file.size / 1024).toFixed(2)} KB
								</p>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										setFile(null);
									}}
								>
									Remove
								</Button>
							</div>
						) : (
							<div className="space-y-2">
								<p className="text-sm text-[var(--sea-ink)]">
									Drop a file here or click to select
								</p>
								<input
									type="file"
									onChange={handleFileChange}
									className="hidden"
									id="file-input"
								/>
								<Button
									type="button"
									variant="outline"
									onClick={(event) => {
										event.preventDefault();
										openFilePicker();
									}}
								>
									Choose File
								</Button>
							</div>
						)}
					</label>

					{/* File Path */}
					<div className="space-y-1.5">
						<Label htmlFor="path">File path</Label>
						<Input
							id="path"
							value={path}
							onChange={(e) => setPath(e.target.value)}
							placeholder="path/to/file.txt"
							required
						/>
					</div>

					{/* Commit Message */}
					<div className="space-y-1.5">
						<Label htmlFor="message">Commit message</Label>
						<Textarea
							id="message"
							value={commitMessage}
							onChange={(e) => setCommitMessage(e.target.value)}
							placeholder="Add file via upload"
							required
							rows={2}
						/>
					</div>

					{/* Submit */}
					<div className="flex gap-3 pt-1">
						<Button
							type="submit"
							disabled={
								!file || !path || !commitMessage || uploadMutation.isPending
							}
						>
							{uploadMutation.isPending ? "Uploading…" : "Upload file"}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() =>
								navigate({
									to: "/repo/$owner/$name",
									params: { owner, name },
									search: { branch },
								})
							}
						>
							Cancel
						</Button>
					</div>

					{uploadMutation.isError && (
						<p className="text-sm text-red-700 dark:text-red-400">
							{uploadMutation.error?.message || "Failed to upload file"}
						</p>
					)}
				</form>
			</div>
		</div>
	);
}
