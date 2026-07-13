/**
 * Tests for the safeRepoPathSchema traversal guard on file server functions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser } from "@/test/mock-routes";

// Allow calling createServerFn handlers directly in tests
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validateFn: (data: unknown) => unknown) => ({
			handler:
				(handlerFn: (args: { data: unknown }) => unknown) =>
				async (args?: { data?: unknown }) =>
					handlerFn({ data: validateFn(args?.data ?? args) }),
		}),
		handler: (handlerFn: (args: unknown) => unknown) => (args: unknown) =>
			handlerFn(args),
	}),
}));

vi.mock("../session", () => ({
	getCurrentUser: vi.fn(() => Promise.resolve(mockUser)),
	getCurrentUserOptional: vi.fn(() => Promise.resolve(mockUser)),
}));

const mockRepo = {
	id: 1,
	ownerId: "user123",
	name: "test-repo",
	owner: { id: "user123", username: "testuser", email: "test@example.com" },
};

vi.mock("../repo-access", () => ({
	getRepoOrThrow: vi.fn(() => Promise.resolve(mockRepo)),
	requireReadAccess: vi.fn(() => Promise.resolve()),
	requireWriteAccess: vi.fn(() => Promise.resolve()),
}));

vi.mock("../git-storage-naming", () => ({
	getRepoStorageCoordinates: vi.fn(() => ({ ownerKey: "user123" })),
}));

const gitOpsMocks = {
	createCommit: vi.fn(() => Promise.resolve("commit-sha")),
	getFileFromBranch: vi.fn(() =>
		Promise.resolve({ content: "hi", size: 2, isBinary: false }),
	),
	getTreeFromBranch: vi.fn(() => Promise.resolve([])),
	deleteFile: vi.fn(() => Promise.resolve({ sha: "sha", message: "msg" })),
	getBranches: vi.fn(() => Promise.resolve([])),
	createBranch: vi.fn(() => Promise.resolve()),
	deleteBranch: vi.fn(() => Promise.resolve()),
	getCommitHistory: vi.fn(() => Promise.resolve([])),
	getCommit: vi.fn(() => Promise.resolve({})),
};

vi.mock("../git-commit-write", () => ({
	createCommit: gitOpsMocks.createCommit,
	deleteFile: gitOpsMocks.deleteFile,
}));
vi.mock("../git-branch-ops", () => ({
	getBranches: gitOpsMocks.getBranches,
	createBranch: gitOpsMocks.createBranch,
	deleteBranch: gitOpsMocks.deleteBranch,
}));
vi.mock("../git-history-ops", () => ({
	getFileFromBranch: gitOpsMocks.getFileFromBranch,
	getTreeFromBranch: gitOpsMocks.getTreeFromBranch,
	getCommitHistory: gitOpsMocks.getCommitHistory,
	getCommit: gitOpsMocks.getCommit,
}));
vi.mock("../git-diff-iso", () => ({
	getCommitDiff: vi.fn(),
	getBranchDiff: vi.fn(),
}));

vi.mock("../../db", () => ({
	db: {
		update: vi.fn(() => ({
			set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
		})),
		insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
	},
}));

const traversalPaths = ["../../../etc/passwd", "/etc/passwd", ".git/config"];

describe("file path traversal guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("uploadFile", () => {
		it.each(traversalPaths)("rejects path %s", async (path) => {
			const { uploadFile } = await import("../files");
			await expect(
				uploadFile({
					data: {
						repoId: 1,
						branchName: "main",
						path,
						content: "aGVsbG8=",
						commitMessage: "msg",
					},
				}),
			).rejects.toThrow();
			expect(gitOpsMocks.createCommit).not.toHaveBeenCalled();
		});

		it("accepts a normal relative path", async () => {
			const { uploadFile } = await import("../files");
			await uploadFile({
				data: {
					repoId: 1,
					branchName: "main",
					path: "src/index.ts",
					content: "aGVsbG8=",
					commitMessage: "msg",
				},
			});
			expect(gitOpsMocks.createCommit).toHaveBeenCalled();
		});
	});

	describe("getFile", () => {
		it.each(traversalPaths)("rejects path %s", async (path) => {
			const { getFile } = await import("../files");
			await expect(
				getFile({ data: { repoId: 1, branchName: "main", path } }),
			).rejects.toThrow();
			expect(gitOpsMocks.getFileFromBranch).not.toHaveBeenCalled();
		});

		it("accepts a normal relative path", async () => {
			const { getFile } = await import("../files");
			await getFile({
				data: { repoId: 1, branchName: "main", path: "src/index.ts" },
			});
			expect(gitOpsMocks.getFileFromBranch).toHaveBeenCalled();
		});
	});

	describe("listFiles", () => {
		it.each(traversalPaths)("rejects path %s", async (path) => {
			const { listFiles } = await import("../files");
			await expect(
				listFiles({ data: { repoId: 1, branchName: "main", path } }),
			).rejects.toThrow();
			expect(gitOpsMocks.getTreeFromBranch).not.toHaveBeenCalled();
		});

		it("accepts the default empty string for the repo root", async () => {
			const { listFiles } = await import("../files");
			await listFiles({ data: { repoId: 1, branchName: "main" } });
			expect(gitOpsMocks.getTreeFromBranch).toHaveBeenCalledWith(
				"user123",
				"test-repo",
				"main",
				"",
			);
		});
	});

	describe("deleteFile", () => {
		it.each(traversalPaths)("rejects path %s", async (path) => {
			const { deleteFile } = await import("../files");
			await expect(
				deleteFile({
					data: { repoId: 1, branchName: "main", path, commitMessage: "msg" },
				}),
			).rejects.toThrow();
			expect(gitOpsMocks.deleteFile).not.toHaveBeenCalled();
		});

		it("accepts a normal relative path", async () => {
			const { deleteFile } = await import("../files");
			await deleteFile({
				data: {
					repoId: 1,
					branchName: "main",
					path: "src/index.ts",
					commitMessage: "msg",
				},
			});
			expect(gitOpsMocks.deleteFile).toHaveBeenCalled();
		});
	});
});
