/**
 * Unit tests for git-operations-iso.ts
 * Tests commit, branch, and file operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
const mockFs = {
  promises: {
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
  },
};

const mockGit = {
  default: {
    add: vi.fn(),
    commit: vi.fn(),
    listBranches: vi.fn(),
    currentBranch: vi.fn(),
    resolveRef: vi.fn(),
    branch: vi.fn(),
    deleteBranch: vi.fn(),
    readBlob: vi.fn(),
    readCommit: vi.fn(),
    readTree: vi.fn(),
    log: vi.fn(),
    checkout: vi.fn(),
    remove: vi.fn(),
  },
};

vi.mock('node:fs', () => mockFs);
vi.mock('isomorphic-git', () => mockGit);
vi.mock('../git-manager-iso', () => ({
  getRepoPath: vi.fn((ownerId: number, repoName: string) => `/data/repos/${ownerId}/${repoName}`),
  getDefaultAuthor: vi.fn(() => ({
    name: 'Test User',
    email: 'test@example.com',
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: 0,
  })),
}));

// @ts-ignore - dynamic import after mock setup
import * as GitOps from '../git-operations-iso';

describe('GitOperations - Core Operations', () => {
  const testOwnerId = 123;
  const testRepoName = 'test-repo';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createCommit', () => {
    it('should create commit with files', async () => {
      const mockCommitSha = 'abc123';
      mockFs.promises.mkdir.mockResolvedValue(undefined);
      mockFs.promises.writeFile.mockResolvedValue(undefined);
      mockGit.default.add.mockResolvedValue(undefined);
      mockGit.default.commit.mockResolvedValue(mockCommitSha);

      const files = [
        { path: 'README.md', content: '# Test Repo' },
        { path: 'src/index.js', content: 'console.log("Hello");' },
      ];

      const result = await GitOps.createCommit(
        testOwnerId,
        testRepoName,
        'Initial commit',
        files,
        'Test Author',
        'test@example.com'
      );

      expect(result).toBe(mockCommitSha);
      expect(mockFs.promises.writeFile).toHaveBeenCalledTimes(2);
      expect(mockGit.default.add).toHaveBeenCalledTimes(2);
      expect(mockGit.default.commit).toHaveBeenCalled();
    });

    it('should use default author if not provided', async () => {
      mockFs.promises.mkdir.mockResolvedValue(undefined);
      mockFs.promises.writeFile.mockResolvedValue(undefined);
      mockGit.default.add.mockResolvedValue(undefined);
      mockGit.default.commit.mockResolvedValue('sha123');

      await GitOps.createCommit(
        testOwnerId,
        testRepoName,
        'Test commit',
        [{ path: 'file.txt', content: 'test' }]
      );

      expect(mockGit.default.commit).toHaveBeenCalled();
    });
  });

  describe('getBranches', () => {
    it('should list all branches', async () => {
      mockGit.default.listBranches.mockResolvedValue(['main', 'develop', 'feature/test']);
      mockGit.default.currentBranch.mockResolvedValue('main');
      mockGit.default.resolveRef.mockImplementation((opts: any) => {
        return Promise.resolve(`sha-${opts.ref}`);
      });

      const result = await GitOps.getBranches(testOwnerId, testRepoName);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        name: 'main',
        current: true,
      });
    });

    it('should return empty array if no branches', async () => {
      mockGit.default.listBranches.mockResolvedValue([]);
      mockGit.default.currentBranch.mockResolvedValue(null);

      const result = await GitOps.getBranches(testOwnerId, testRepoName);

      expect(result).toEqual([]);
    });
  });

  describe('createBranch', () => {
    it('should create branch from base ref', async () => {
      mockGit.default.resolveRef.mockResolvedValue('base-commit-sha');
      mockGit.default.branch.mockResolvedValue(undefined);

      await GitOps.createBranch(
        testOwnerId,
        testRepoName,
        'feature/new',
        'main'
      );

      expect(mockGit.default.resolveRef).toHaveBeenCalled();
      expect(mockGit.default.branch).toHaveBeenCalled();
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch', async () => {
      mockGit.default.deleteBranch.mockResolvedValue(undefined);

      await GitOps.deleteBranch(testOwnerId, testRepoName, 'feature/old');

      expect(mockGit.default.deleteBranch).toHaveBeenCalled();
    });
  });

  describe('getBlob', () => {
    it('should read blob by SHA', async () => {
      const mockContent = Buffer.from('Hello, World!');
      mockGit.default.readBlob.mockResolvedValue({ blob: mockContent });

      const result = await GitOps.getBlob(testOwnerId, testRepoName, 'blob-sha');

      expect(result).toEqual(mockContent);
      expect(mockGit.default.readBlob).toHaveBeenCalled();
    });
  });
});
