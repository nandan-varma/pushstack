import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { useState } from "react";
import { Panel, PanelFooter } from "@/components/layout/panel";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
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
import { getSession } from "@/lib/auth-session";
import { formatFileSize } from "@/lib/language-detection";
import { MAX_WEB_UPLOAD_BYTES, UPLOAD_WARNING_BYTES } from "@/lib/limits";
import {
	queryKeys,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { uploadFile } from "@/server/files";

function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			const commaIndex = result.indexOf(",");
			resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
		};
		reader.onerror = () =>
			reject(reader.error ?? new Error("Failed to read file"));
		reader.readAsDataURL(file);
	});
}

export const Route = createFileRoute("/$owner/$name/upload")({
	validateSearch: (search: Record<string, unknown>): { branch?: string } => ({
		branch: (search.branch as string) || undefined,
	}),
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) {
			throw redirect({ to: "/auth/login" });
		}
	},
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(
				repositoryBranchesQueryOptions(repo.id),
			);
		}
	},
	component: FileUploadPage,
});

function FileUploadPage() {
	const { owner, name } = Route.useParams();
	const { branch: searchBranch } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const [file, setFile] = useState<File | null>(null);
	const [path, setPath] = useState("");
	const [commitMessage, setCommitMessage] = useState("");
	const [selectedBranch, setBranch] = useState<string | null>(
		searchBranch ?? null,
	);
	const [isDragging, setIsDragging] = useState(false);
	const [isEncoding, setIsEncoding] = useState(false);

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const branch = selectedBranch ?? repo?.defaultBranch ?? "";

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});
	// A brand-new repo has no branches yet (no commits at all): offer its
	// default branch, which the first upload creates.
	const branchOptions =
		branches && branches.length > 0 ? branches : [{ name: branch }];

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
			toast("File uploaded", "success");
			navigate({
				to: "/$owner/$name/tree/$branch/$",
				params: { owner, name, branch, _splat: "" },
			});
		},
		onError: (err: Error) => {
			toast(err.message || "Failed to upload file", "error");
		},
	});

	// A path the person typed stays; one we filled from the previous file
	// follows the new file.
	const chooseFile = (next: File) => {
		setFile(next);
		if (!path || path === file?.name) setPath(next.name);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const dropped = e.dataTransfer.files[0];
		if (dropped) chooseFile(dropped);
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	};

	const handleDragLeave = () => {
		setIsDragging(false);
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const chosen = e.target.files?.[0];
		if (chosen) chooseFile(chosen);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!file || !path || !commitMessage || !repo) return;

		setIsEncoding(true);
		try {
			const base64 = await readFileAsBase64(file);
			uploadMutation.mutate({
				data: {
					repoId: repo.id,
					branchName: branch,
					path,
					content: base64,
					commitMessage,
				},
			});
		} catch {
			toast("Failed to read file", "error");
		} finally {
			setIsEncoding(false);
		}
	};

	const isSubmitting = isEncoding || uploadMutation.isPending;
	const loadingLabel = isEncoding ? "Reading file…" : "Uploading…";

	return (
		<div className="max-w-[760px] space-y-5">
			<PageHeader
				title="Add a file"
				description="Upload one file and commit it in a single step. For anything bigger, push with git."
			/>
			<Panel>
				<form onSubmit={handleSubmit}>
					<div className="space-y-5 p-5">
						<input
							type="file"
							onChange={handleFileChange}
							className="peer sr-only"
							id="file-input"
						/>
						<label
							htmlFor="file-input"
							className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-[14px] border border-dashed px-6 py-8 text-center transition-[background-color,border-color] peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 ${
								isDragging
									? "border-bjork-accent bg-bjork-accent-soft"
									: "border-bjork-border-strong bg-bjork-field-inset hover:border-bjork-accent/60"
							}`}
							onDrop={handleDrop}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
						>
							<Upload
								aria-hidden="true"
								className="size-6 text-bjork-text-soft"
							/>
							{file ? (
								<>
									<p className="text-sm font-medium text-bjork-text">
										{file.name}{" "}
										<span className="font-normal text-bjork-text-soft">
											{formatFileSize(file.size)}
										</span>
									</p>
									{file.size > UPLOAD_WARNING_BYTES && (
										<p className="max-w-md text-xs text-warning">
											Large files stall the browser while encoding, and web
											uploads stop at {formatFileSize(MAX_WEB_UPLOAD_BYTES)} —
											use <code className="font-mono">git push</code> instead.
										</p>
									)}
									<p className="text-xs text-bjork-text-soft">
										Drop or click to choose a different file
									</p>
								</>
							) : (
								<>
									<p className="text-sm font-medium text-bjork-text">
										Drop a file, or click to choose one
									</p>
									<p className="text-xs text-bjork-text-soft">
										Up to {formatFileSize(MAX_WEB_UPLOAD_BYTES)}
									</p>
								</>
							)}
						</label>

						<div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
							<div className="space-y-2">
								<Label htmlFor="branch">Branch</Label>
								<Select value={branch} onValueChange={setBranch}>
									<SelectTrigger id="branch" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{branchOptions.map((b) => (
											<SelectItem key={b.name} value={b.name}>
												{b.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="path">Path in the repository</Label>
								<Input
									id="path"
									value={path}
									onChange={(e) => setPath(e.target.value)}
									placeholder="path/to/file.txt"
									className="font-mono text-[13px]"
									required
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="message">Commit message</Label>
							<Input
								id="message"
								value={commitMessage}
								onChange={(e) => setCommitMessage(e.target.value)}
								placeholder="Add file via upload"
								required
							/>
						</div>

						{uploadMutation.isError && (
							<ErrorAlert
								message={
									uploadMutation.error?.message || "Failed to upload file"
								}
							/>
						)}
					</div>
					<PanelFooter>
						<Button
							type="button"
							variant="outline"
							disabled={isSubmitting}
							onClick={() =>
								navigate({
									to: "/$owner/$name/tree/$branch/$",
									params: { owner, name, branch, _splat: "" },
								})
							}
						>
							Cancel
						</Button>
						<LoadingButton
							type="submit"
							disabled={!file || !path || !commitMessage}
							isLoading={isSubmitting}
							loadingLabel={loadingLabel}
						>
							Upload file
						</LoadingButton>
					</PanelFooter>
				</form>
			</Panel>
		</div>
	);
}
