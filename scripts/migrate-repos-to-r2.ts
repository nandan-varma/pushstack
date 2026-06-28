#!/usr/bin/env tsx
/**
 * Migration Script: Filesystem to R2
 * 
 * Migrates existing filesystem-based git repositories to R2 object storage.
 * Runs incrementally to avoid overwhelming the system.
 * 
 * Usage: tsx scripts/migrate-repos-to-r2.ts [--batch-size=10] [--dry-run]
 */

import { db } from '../src/db'
import { repositories } from '../src/db/github-schema'
import { eq, isNull, or } from 'drizzle-orm'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { bulkUploadToR2 } from '../src/lib/r2-operations'
import { getRepoGitStoragePrefix, getRepoStorageCoordinates } from '../src/server/git-storage-naming'

// Configuration
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10)
const DRY_RUN = process.argv.includes('--dry-run')
const GIT_REPOS_PATH = process.env.GIT_REPOS_PATH || join(os.homedir(), '.pushstack', 'repos')

interface MigrationStats {
  total: number
  migrated: number
  skipped: number
  errors: number
}

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = []
  
  try {
    const entries = readdirSync(dir)
    
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      
      if (stat.isDirectory()) {
        files.push(...getAllFiles(fullPath, baseDir))
      } else {
        // Return path relative to base directory
        files.push(fullPath.replace(baseDir + '/', ''))
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error)
  }
  
  return files
}

/**
 * Migrate a single repository from filesystem to R2
 */
async function migrateRepository(repo: typeof repositories.$inferSelect & {
  owner: { id: string; username: string | null; email: string }
}): Promise<boolean> {
  const storage = getRepoStorageCoordinates(repo)
  const repoPath = join(GIT_REPOS_PATH, storage.ownerKey, repo.name)

  if (!existsSync(repoPath)) {
    console.log(`  Repository not found on filesystem for ${storage.ownerKey}/${repo.name}`)
    return false
  }
  
  console.log(`  Migrating ${storage.ownerKey}/${repo.name}...`)
  
  try {
    // Get all files in repository
    const files = getAllFiles(repoPath)
    console.log(`     Found ${files.length} files`)
    
    if (files.length === 0) {
      console.log(`     ⚠️  No files found, skipping`)
      return false
    }
    
    // Prepare uploads
    const uploads = files.map(file => {
      const fullPath = join(repoPath, file)
      const content = readFileSync(fullPath)
      const r2Key = `${getRepoGitStoragePrefix(storage.ownerKey, repo.name)}${file}`
      
      // Determine content type
      let contentType = 'application/octet-stream'
      if (file.startsWith('refs/') || file === 'HEAD' || file === 'config') {
        contentType = 'text/plain'
      }
      
      return {
        key: r2Key,
        data: content,
        contentType,
      }
    })
    
    if (DRY_RUN) {
      console.log(`     [DRY RUN] Would upload ${uploads.length} files to R2`)
      return true
    }
    
    // Upload files in chunks of 100
    const chunkSize = 100
    let uploaded = 0
    
    for (let i = 0; i < uploads.length; i += chunkSize) {
      const chunk = uploads.slice(i, i + chunkSize)
      const results = await bulkUploadToR2(chunk)
      
      const successCount = results.filter(r => r.success).length
      uploaded += successCount
      
      if (successCount < chunk.length) {
        console.log(`     ⚠️  Some uploads failed: ${successCount}/${chunk.length}`)
      }
    }
    
    console.log(`     ✅ Uploaded ${uploaded}/${files.length} files`)
    
    // Update repository record to mark as migrated
    await db.update(repositories)
      .set({ 
        lastBackupAt: new Date(),
        backupR2Key: `repos/${storage.ownerKey}/${repo.name}`,
      })
      .where(eq(repositories.id, repo.id))
    
    return true
  } catch (error) {
    console.error(`     ❌ Error migrating repository:`, error)
    return false
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('🚀 Starting repository migration to R2')
  console.log(`   Batch size: ${BATCH_SIZE}`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log(`   Git repos path: ${GIT_REPOS_PATH}`)
  console.log('')
  
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
  }
  
  try {
    // Find repositories that haven't been migrated yet
    // (those without lastBackupAt or backupR2Key)
    const repos = await db.query.repositories.findMany({
      where: or(
        isNull(repositories.lastBackupAt),
        isNull(repositories.backupR2Key)
      ),
      with: {
        owner: true,
      },
      limit: BATCH_SIZE,
    })
    
    stats.total = repos.length
    
    if (repos.length === 0) {
      console.log('✅ No repositories to migrate')
      return
    }
    
    console.log(`Found ${repos.length} repositories to migrate\n`)
    
    // Migrate each repository
    for (const repo of repos) {
      const success = await migrateRepository(repo)
      
      if (success) {
        stats.migrated++
      } else {
        stats.skipped++
      }
      
      console.log('')
    }
    
    // Summary
    console.log('📊 Migration Summary')
    console.log(`   Total: ${stats.total}`)
    console.log(`   Migrated: ${stats.migrated}`)
    console.log(`   Skipped: ${stats.skipped}`)
    console.log(`   Errors: ${stats.errors}`)
    console.log('')
    
    if (stats.migrated < stats.total) {
      console.log('⚠️  Not all repositories were migrated')
      console.log('   Run the script again to continue migration')
    } else {
      console.log('✅ All repositories in this batch migrated successfully')
    }
    
    // Check if there are more repositories to migrate
    const remaining = await db.query.repositories.findMany({
      where: or(
        isNull(repositories.lastBackupAt),
        isNull(repositories.backupR2Key)
      ),
      with: {
        owner: true,
      },
      limit: 1,
    })
    
    if (remaining.length > 0) {
      console.log(`\n🔄 More repositories remaining, run the script again`)
    } else {
      console.log(`\n🎉 All repositories have been migrated!`)
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }
}

// Run migration
migrate().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
