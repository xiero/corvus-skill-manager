import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {DiscoveredSkill} from '../skills/skillDiscovery.js';

/**
 * Returns IDs whose complete registered skill directory differs between two discoveries.
 * Directory entries are lexical, symlinks are hashed by target, and symlinks are never followed.
 */
export async function findChangedSkillContentIds(options: {
  currentSkills: readonly DiscoveredSkill[];
  candidateSkills: readonly DiscoveredSkill[];
}): Promise<string[]> {
  const currentById = new Map(options.currentSkills.map((skill) => [skill.id, skill]));
  const candidateById = new Map(options.candidateSkills.map((skill) => [skill.id, skill]));
  const sharedIds = [...currentById.keys()]
    .filter((id) => candidateById.has(id))
    .sort((left, right) => left.localeCompare(right));
  const changed: string[] = [];

  for (const id of sharedIds) {
    const current = currentById.get(id);
    const candidate = candidateById.get(id);
    if (current === undefined || candidate === undefined) continue;

    const [currentFingerprint, candidateFingerprint] = await Promise.all([
      fingerprintDirectory(current.absolutePath),
      fingerprintDirectory(candidate.absolutePath)
    ]);
    if (currentFingerprint !== candidateFingerprint) changed.push(id);
  }

  return changed;
}

async function fingerprintDirectory(rootPath: string): Promise<string> {
  const hash = createHash('sha256');

  async function visit(currentPath: string): Promise<void> {
    const entries = (await fs.readdir(currentPath, {withFileTypes: true})).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, entryPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        updateHash(hash, 'directory', relativePath, '');
        await visit(entryPath);
      } else if (entry.isFile()) {
        updateHash(hash, 'file', relativePath, await fs.readFile(entryPath));
      } else if (entry.isSymbolicLink()) {
        updateHash(hash, 'symlink', relativePath, await fs.readlink(entryPath));
      } else {
        updateHash(hash, 'other', relativePath, '');
      }
    }
  }

  await visit(rootPath);
  return hash.digest('hex');
}

function updateHash(
  hash: ReturnType<typeof createHash>,
  kind: string,
  relativePath: string,
  content: string | Buffer
): void {
  hash.update(kind);
  hash.update('\0');
  hash.update(relativePath);
  hash.update('\0');
  hash.update(content);
  hash.update('\0');
}
