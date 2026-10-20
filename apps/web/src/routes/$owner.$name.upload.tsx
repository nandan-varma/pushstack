import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast-provider";
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
import { Textarea } from "@/components/ui/textarea";
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
		<div className="mx-auto max-w-2xl">
			<div className="mb-6">
				<Link
					to="/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch, _splat: "" }}
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="size-4" />
					{owner}/{name}
				</Link>
			</div>
			<div className="island-shell rounded-2xl p-8">
				<div className="mb-6">
					<h2 className="text-lg font-semibold text-foreground">
						Upload file to {owner}/{name}
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Add a new file to the repository via web upload.
					</p>
				</div>
				<form onSubmit={handleSubmit} className="space-y-5">
					<div className="space-y-1.5">
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

					<label
						htmlFor="file-input"
						className={`block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
							isDragging
								? "border-primary bg-primary/5"
								: "border-border hover:border-primary/50"
						}`}
						onDrop={handleDrop}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
					>
						{file ? (
							<div className="space-y-2">
								<p className="text-sm font-medium text-foreground">
									{file.name}
								</p>
								<p className="text-xs text-muted-foreground">
									{(file.size / 1024).toFixed(2)} KB
								</p>
								{file.size > UPLOAD_WARNING_BYTES && (
									<p className="text-xs text-amber-600 dark:text-amber-400">
										This file is large enough that the browser will stutter
										while encoding it, and web uploads are refused above{" "}
										{formatFileSize(MAX_WEB_UPLOAD_BYTES)} — use{" "}
										<code className="font-mono">git push</code> for files this
										big.
									</p>
								)}
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
								<p className="text-sm text-foreground">
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

					<div className="flex gap-3 pt-1">
						<LoadingButton
							type="submit"
							disabled={!file || !path || !commitMessage}
							isLoading={isSubmitting}
							loadingLabel={loadingLabel}
						>
							Upload file
						</LoadingButton>
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
