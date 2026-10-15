import {promises as fs} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createStubGit, createTestHome, listTree, type TestHome} from '../../../../test/support/appHarness.js';
import {v3BundleSkillpackFixture, v3BundleSkillpackUpdateFixture, writeSkillpack} from '../../../../test/support/skillpackFixtures.js';
import {loadConfig, saveConfig} from '../config/configStore.js';
import {loadManifest} from '../manifest/manifestStore.js';
import {applyLinkPlan} from '../links/applyEngine.js';
import type {ProfileScope} from '../profiles/profileScope.js';
import {createCorvusApplication} from './createCorvusApplication.js';

const homes: TestHome[] = [];
afterEach(async () => {await Promise.all(homes.splice(0).map((home) => home.cleanup()));});
async function fixture() {
  const home = await createTestHome({skillpack: v3BundleSkillpackFixture});
  homes.push(home);
  const app = createCorvusApplication({homeDir: home.homeDir, git: createStubGit({commitHash: home.commitHash}).runner});
  const rootA = path.join(home.homeDir, 'project-a');
  const rootB = path.join(home.homeDir, 'project-b');
  await fs.mkdir(rootA); await fs.mkdir(rootB);
  return {home, app, rootA, rootB};
}
const scopeFor = (rootPath: string): ProfileScope => ({kind: 'project', rootPath});
const request = (scope?: ProfileScope) => ({schemaVersion: 2, ...(scope ? {scope} : {}), targetAgents: ['codex'], selectedSkills: [{id: 'review-helper'}], replaceSelection: true});
async function apply(app: ReturnType<typeof createCorvusApplication>, input: unknown) {
  const plan = await app.installPlan(input);
  if (!plan.ok || !plan.data.planId) throw new Error(JSON.stringify(plan.errors));
  const result = await app.installApply({planId: plan.data.planId, confirm: plan.data.planId});
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  return plan.data;
}

describe('project profiles', () => {
  it('keeps global, project A and project B selections and links isolated, including dependencies', async () => {
    const {home, app, rootA, rootB} = await fixture();
    await apply(app, request());
    const planA = await apply(app, request(scopeFor(rootA)));
    await apply(app, {...request(scopeFor(rootB)), selectedSkills: [], selectedBundles: [{id: 'documentation'}]});
    const config = await loadConfig(home.configPath);
    expect(config.version).toBe(4);
    expect(config.agents?.codex?.selectedSkillIds).toEqual(['corvus-skillpack:review-helper']);
    expect(config.projects?.[rootA]?.agents.codex?.selectedSkillIds).toEqual(['corvus-skillpack:review-helper']);
    expect(config.projects?.[rootB]?.agents.codex?.selectedBundleIds).toEqual(['corvus-skillpack:documentation']);
    expect((await fs.lstat(path.join(rootA, '.agents/skills/git-basics'))).isSymbolicLink()).toBe(true);
    const verify = await app.installVerify({planId: planA.planId!});
    expect(verify.ok && verify.data.status).toBe('verified');
    const empty = await apply(app, {...request(scopeFor(rootA)), selectedSkills: []});
    expect(empty.plan.operations.every((operation) => operation.targetPath.startsWith(rootA))).toBe(true);
    await expect(fs.lstat(path.join(rootA, '.agents/skills/review-helper'))).rejects.toMatchObject({code: 'ENOENT'});
    expect((await fs.lstat(path.join(rootB, '.agents/skills/docs-helper'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(home.homeDir, '.agents/skills/review-helper'))).isSymbolicLink()).toBe(true);
  });

  it('does not write when listing, selecting or reporting a project; canonicalizes aliases', async () => {
    const {home, app, rootA} = await fixture();
    const alias = path.join(home.homeDir, 'alias'); await fs.symlink(rootA, alias);
    const before = await listTree(home.homeDir);
    const bytes = await fs.readFile(home.configPath, 'utf8');
    const resolved = await app.resolveProject({rootPath: alias});
    expect(resolved.ok && resolved.data.scope).toEqual(scopeFor(rootA));
    expect((await app.listProjects()).ok).toBe(true);
    expect((await app.status({scope: scopeFor(alias)})).ok).toBe(true);
    expect((await app.doctor({scope: scopeFor(rootA)})).ok).toBe(true);
    expect((await app.listAgents({scope: scopeFor(rootA)})).ok).toBe(true);
    expect(await fs.readFile(home.configPath, 'utf8')).toBe(bytes);
    expect(await listTree(home.homeDir)).toEqual(before);
    await apply(app, request(scopeFor(alias)));
    expect(Object.keys((await loadConfig(home.configPath)).projects ?? {})).toEqual([rootA]);
  });

  it('requires confirmation, preserves project drafts until approval and applies idempotently', async () => {
    const {home, app, rootA} = await fixture();
    const plan = await app.installPlan(request(scopeFor(rootA)));
    expect(plan.ok).toBe(true); if (!plan.ok) return;
    expect((await loadConfig(home.configPath)).projects?.[rootA]).toBeUndefined();
    expect(await listTree(rootA)).toEqual([]);
    expect((await app.installApply({planId: plan.data.planId!, confirm: 'wrong'})).ok).toBe(false);
    expect((await app.installApply({planId: plan.data.planId!, confirm: plan.data.planId!})).ok).toBe(true);
    const repeated = await app.installApply({planId: plan.data.planId!, confirm: plan.data.planId!});
    expect(repeated.ok && repeated.data.status).toBe('already-satisfied');
  });

  it('disables a project agent while preserving roots and leaving global links in place', async () => {
    const {home, app, rootA} = await fixture();
    await apply(app, request()); await apply(app, request(scopeFor(rootA)));
    const disabled = await apply(app, {...request(scopeFor(rootA)), enabled: false});
    expect((await loadConfig(home.configPath)).projects?.[rootA]?.agents.codex?.enabled).toBe(false);
    expect((await fs.lstat(path.join(home.homeDir, '.agents/skills/review-helper'))).isSymbolicLink()).toBe(true);
    const verification = await app.installVerify({planId: disabled.planId!});
    expect(verification.ok && verification.data.status).toBe('verified');
  });

  it('moves a project target by removing only its previously owned links', async () => {
    const {app, rootA} = await fixture();
    await apply(app, request(scopeFor(rootA)));
    const moved = await apply(app, {...request(scopeFor(rootA)), agentTargetPaths: {codex: '.local-skills'}});
    expect(moved.plan.summary.removals).toBe(2);
    await expect(fs.lstat(path.join(rootA, '.agents/skills/review-helper'))).rejects.toMatchObject({code: 'ENOENT'});
    expect((await fs.lstat(path.join(rootA, '.local-skills/review-helper'))).isSymbolicLink()).toBe(true);
  });

  it('blocks traversal, manager and skillpack targets, symlink parents and unmanaged files', async () => {
    const {home, app, rootA, rootB} = await fixture();
    for (const target of ['../../outside', home.managerStateDir, home.checkoutPath]) {
      expect((await app.installPlan({...request(scopeFor(rootA)), agentTargetPaths: {codex: target}})).ok).toBe(false);
    }
    expect((await app.resolveProject({rootPath: home.checkoutPath})).ok).toBe(false);
    expect((await app.resolveProject({rootPath: home.managerStateDir})).ok).toBe(false);
    await fs.symlink(rootB, path.join(rootA, '.agents'));
    expect((await app.installPlan(request(scopeFor(rootA)))).ok).toBe(false);
    await fs.unlink(path.join(rootA, '.agents'));
    await fs.mkdir(path.join(rootA, '.agents/skills'), {recursive: true});
    await fs.writeFile(path.join(rootA, '.agents/skills/review-helper'), 'user data');
    expect((await app.installPlan(request(scopeFor(rootA)))).ok).toBe(false);
    expect(await fs.readFile(path.join(rootA, '.agents/skills/review-helper'), 'utf8')).toBe('user data');
    expect(await listTree(rootB)).toEqual([]);
  });

  it('rejects swapped or missing roots and redirected target parents after preview without writes', async () => {
    for (const change of ['missing', 'replaced', 'redirected'] as const) {
      const {home, app, rootA, rootB} = await fixture();
      const plan = await app.installPlan(request(scopeFor(rootA)));
      expect(plan.ok).toBe(true); if (!plan.ok) continue;
      if (change === 'redirected') await fs.symlink(rootB, path.join(rootA, '.agents'));
      else {await fs.rename(rootA, `${rootA}-old`); if (change === 'replaced') await fs.mkdir(rootA);}
      const bytes = await fs.readFile(home.configPath, 'utf8');
      const result = await app.installApply({planId: plan.data.planId!, confirm: plan.data.planId!});
      expect(result.ok).toBe(false);
      expect(result.errors[0]?.code).toBe('STALE_PLAN');
      expect(await fs.readFile(home.configPath, 'utf8')).toBe(bytes);
      expect(await listTree(rootB)).toEqual([]);
    }
  });

  it('rejects cross-profile ownership even when an existing link has disappeared', async () => {
    const {home, app, rootA} = await fixture();
    await apply(app, request(scopeFor(rootA)));
    await fs.unlink(path.join(rootA, '.agents/skills/review-helper'));
    const result = await app.installPlan({...request(), agentTargetPaths: {codex: path.join(rootA, '.agents/skills')}});
    expect(result.ok).toBe(false);
    const manifest = await loadManifest(path.join(home.managerStateDir, 'manifest.json'));
    expect(manifest.links[path.join(rootA, '.agents/skills/review-helper')]?.scope).toEqual(scopeFor(rootA));
  });

  it('protects project ownership from a global target alias even when the link is missing', async () => {
    const {home, app, rootA} = await fixture();
    const installed = await apply(app, request(scopeFor(rootA)));
    const target = path.join(rootA, '.agents/skills/review-helper');
    await fs.unlink(target);
    const alias = path.join(home.homeDir, 'project-skills-alias');
    await fs.symlink(path.join(rootA, '.agents/skills'), alias);
    const planned = await app.installPlan({...request(), agentTargetPaths: {codex: alias}});
    expect(planned.ok).toBe(false);
    const create = installed.plan.operations.find((operation) => operation.type === 'create-link' && operation.skillId.endsWith(':review-helper'))!;
    const {scope: _scope, ...unscoped} = create;
    const direct = await applyLinkPlan({
      managerStateDir: home.managerStateDir,
      homeDir: home.homeDir,
      skillpackCheckoutPath: home.checkoutPath,
      plan: {operations: [{...unscoped, targetPath: path.join(alias, 'review-helper')}], conflicts: [], warnings: []}
    });
    expect(direct.applied).toHaveLength(0);
    expect(direct.skipped[0]?.code).toBe('manifest-mismatch');
    await expect(fs.lstat(target)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('blocks two agents from sharing ownership of the same project target', async () => {
    const {app, rootA} = await fixture();
    await apply(app, request(scopeFor(rootA)));
    const result = await app.installPlan({...request(scopeFor(rootA)), targetAgents: ['claude'], agentTargetPaths: {claude: '.agents/skills'}});
    expect(result.ok).toBe(false);
    expect((await fs.lstat(path.join(rootA, '.agents/skills/review-helper'))).isSymbolicLink()).toBe(true);
  });

  it('removes a project only after approval and preserves other profiles and unmanaged content', async () => {
    const {home, app, rootA, rootB} = await fixture();
    await apply(app, request()); await apply(app, request(scopeFor(rootA))); await apply(app, request(scopeFor(rootB)));
    await fs.writeFile(path.join(rootA, 'README.md'), 'project content');
    const plan = await app.projectRemovePlan({rootPath: rootA});
    expect(plan.ok).toBe(true); if (!plan.ok) return;
    expect((await app.projectRemoveApply({planId: plan.data.planId, confirm: 'wrong'})).ok).toBe(false);
    expect((await app.projectRemoveApply({planId: plan.data.planId, confirm: plan.data.planId})).ok).toBe(true);
    expect((await loadConfig(home.configPath)).projects?.[rootA]).toBeUndefined();
    expect((await loadConfig(home.configPath)).projects?.[rootB]).toBeDefined();
    expect(await fs.readFile(path.join(rootA, 'README.md'), 'utf8')).toBe('project content');
    expect((await fs.lstat(path.join(rootB, '.agents/skills/review-helper'))).isSymbolicLink()).toBe(true);
  });

  it('blocks removal after a target was replaced', async () => {
    const {home, app, rootA} = await fixture();
    await apply(app, request(scopeFor(rootA)));
    const plan = await app.projectRemovePlan({rootPath: rootA});
    expect(plan.ok).toBe(true); if (!plan.ok) return;
    const target = path.join(rootA, '.agents/skills/review-helper');
    await fs.unlink(target); await fs.writeFile(target, 'replacement');
    expect((await app.projectRemoveApply({planId: plan.data.planId, confirm: plan.data.planId})).ok).toBe(false);
    expect(await fs.readFile(target, 'utf8')).toBe('replacement');
    expect((await loadConfig(home.configPath)).projects?.[rootA]).toBeDefined();
  });

  it('prevents removing a secondary skillpack while a disabled project still selects its roots', async () => {
    const home = await createTestHome({skillpackId: 'team', skillpack: v3BundleSkillpackFixture});
    homes.push(home);
    const rootPath = path.join(home.homeDir, 'project'); await fs.mkdir(rootPath);
    const app = createCorvusApplication({homeDir: home.homeDir, git: createStubGit({commitHash: home.commitHash}).runner});
    await apply(app, {...request(scopeFor(rootPath)), enabled: false, selectedSkills: [{id: 'team:review-helper'}]});
    const result = await app.skillpackRemovePlan({skillpackId: 'team'});
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.errors)).toContain(rootPath);
  });

  it('rejects manager targets within a selected ancestor project and reports missing projects without writes', async () => {
    const {home, app, rootA} = await fixture();
    const forbidden = await app.installPlan({...request(scopeFor(home.homeDir)), agentTargetPaths: {codex: home.managerStateDir}});
    expect(forbidden.ok).toBe(false);
    const before = await listTree(home.homeDir);
    const result = await app.status({scope: scopeFor(path.join(rootA, 'missing'))});
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('INVALID_REQUEST');
    expect(await listTree(home.homeDir)).toEqual(before);
  });

  it('invalidates a pending plan when its configured project target changes', async () => {
    const {home, app, rootA} = await fixture();
    await apply(app, request(scopeFor(rootA)));
    const plan = await app.installPlan({...request(scopeFor(rootA)), selectedSkills: [{id: 'docs-helper'}]});
    expect(plan.ok).toBe(true); if (!plan.ok) return;
    const config = await loadConfig(home.configPath);
    config.projects![rootA]!.agents.codex!.targetPath = path.join(rootA, 'other-target');
    await saveConfig(config, {configPath: home.configPath});
    const result = await app.installApply({planId: plan.data.planId!, confirm: plan.data.planId!});
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('STALE_PLAN');
    expect((await fs.lstat(path.join(rootA, '.agents/skills/review-helper'))).isSymbolicLink()).toBe(true);
  });

  it('includes project usage in collection update previews and invalidates them when usage changes', async () => {
    const {home, app, rootA} = await fixture();
    await apply(app, {...request(scopeFor(rootA)), selectedSkills: [], selectedBundles: [{id: 'default'}]});
    const remote = createCorvusApplication({homeDir: home.homeDir, git: createStubGit({commitHash: home.commitHash, remoteCommitHash: 'b'.repeat(40), onClone: (target) => writeSkillpack(target, v3BundleSkillpackUpdateFixture)}).runner});
    const preview = await remote.skillpackUpdatePreview();
    expect(preview.ok).toBe(true); if (!preview.ok) return;
    expect(preview.data.plan?.affectedProjects).toEqual([rootA]);
    expect(preview.data.plan?.affectedBundles?.some((bundle) => bundle.bundleId === 'default')).toBe(true);
    const config = await loadConfig(home.configPath);
    await saveConfig({...config, projects: {}}, {configPath: home.configPath});
    const result = await remote.skillpackUpdateApply({planId: preview.data.planId!, confirm: preview.data.planId!});
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('STALE_PLAN');
  });
});
