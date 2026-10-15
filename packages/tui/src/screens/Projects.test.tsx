import React, {useState} from 'react';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createCorvusApplication, loadConfig, type ManagerConfig} from '@corvus-tools/skill-manager-core';
import {createStubGit, createTestHome, listTree, type TestHome} from '../../../../test/support/appHarness.js';
import {v3BundleSkillpackFixture} from '../../../../test/support/skillpackFixtures.js';
import {CorvusApplicationContext} from '../application/applicationContext.js';
import {ProjectsScreen} from './ProjectsScreen.js';
import {ProjectSkillsScreen} from './ProjectSkillsScreen.js';

type Key = {return?: boolean; downArrow?: boolean; escape?: boolean};
const ink = vi.hoisted(() => ({handler: undefined as ((input: string, key: Key) => void) | undefined}));
vi.mock('ink', async (original) => ({...await original<typeof import('ink')>(), useInput: (handler: typeof ink.handler) => {ink.handler = handler;}}));
let renderer: ReactTestRenderer | undefined;
const homes: TestHome[] = [];
afterEach(async () => {act(() => renderer?.unmount()); renderer = undefined; await Promise.all(homes.splice(0).map((home) => home.cleanup()));});
const text = () => JSON.stringify(renderer?.toJSON());
function press(input: string, key: Key = {}) {act(() => ink.handler?.(input, key));}
async function until(predicate: () => boolean) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await act(async () => {await new Promise((resolve) => setTimeout(resolve, 15));});
  }
  throw new Error(`Screen did not reach expected state: ${text()}`);
}
async function fixture() {
  const home = await createTestHome({skillpack: v3BundleSkillpackFixture}); homes.push(home);
  const rootPath = path.join(home.homeDir, 'company-project'); await fs.mkdir(rootPath);
  const app = createCorvusApplication({homeDir: home.homeDir, git: createStubGit({commitHash: home.commitHash}).runner});
  return {home, rootPath, app, config: await loadConfig(home.configPath)};
}

describe('project TUI', () => {
  it('selects a project by path without registering it or writing to the project', async () => {
    const {home, rootPath, app} = await fixture();
    const selected = vi.fn();
    const before = await fs.readFile(home.configPath, 'utf8');
    await act(async () => {renderer = create(<CorvusApplicationContext.Provider value={app}><ProjectsScreen onBack={vi.fn()} onChanged={vi.fn()} onSelect={selected} /></CorvusApplicationContext.Provider>);});
    press('n'); press(rootPath); press('', {return: true});
    await until(() => selected.mock.calls.length === 1);
    expect(selected).toHaveBeenCalledWith({kind: 'project', rootPath});
    expect(await fs.readFile(home.configPath, 'utf8')).toBe(before);
    expect(await listTree(rootPath)).toEqual([]);
  });

  it('previews a project bundle, cancels without writes, then applies only after a', async () => {
    const {home, rootPath, app, config} = await fixture();
    const scope = {kind: 'project' as const, rootPath};
    function Host() {
      const [saved, setSaved] = useState<ManagerConfig>(config);
      return <CorvusApplicationContext.Provider value={app}><ProjectSkillsScreen scope={scope} config={saved} onBack={vi.fn()} onConfigSaved={setSaved} guided /></CorvusApplicationContext.Provider>;
    }
    await act(async () => {renderer = create(<Host />);});
    press('', {return: true});
    await until(() => text().includes('corvus-skillpack:default'));
    press(' '); press('p');
    await until(() => text().includes('approve and apply'));
    expect(await listTree(rootPath)).toEqual([]);
    expect((await loadConfig(home.configPath)).projects?.[rootPath]).toBeUndefined();
    press('b');
    expect(text()).toContain('Select an agent');
    press('', {return: true}); press('p');
    await until(() => text().includes('approve and apply'));
    press('a');
    await until(() => text().includes('Apply: applied'));
    const saved = await loadConfig(home.configPath);
    expect(saved.projects?.[rootPath]?.agents.codex?.selectedBundleIds).toEqual(['corvus-skillpack:default']);
    expect(saved.agents?.codex).toBeUndefined();
    expect((await fs.lstat(path.join(rootPath, '.agents/skills/git-basics'))).isSymbolicLink()).toBe(true);
  });

  it('lists saved projects and requires approval before removal', async () => {
    const {rootPath, app, home} = await fixture();
    const plan = await app.installPlan({schemaVersion: 2, scope: {kind: 'project', rootPath}, targetAgents: ['codex'], selectedSkills: [{id: 'review-helper'}]});
    if (!plan.ok) throw new Error(JSON.stringify(plan.errors));
    await app.installApply({planId: plan.data.planId!, confirm: plan.data.planId!});
    const changed = vi.fn();
    await act(async () => {renderer = create(<CorvusApplicationContext.Provider value={app}><ProjectsScreen onBack={vi.fn()} onChanged={changed} onSelect={vi.fn()} /></CorvusApplicationContext.Provider>);});
    await until(() => text().includes(rootPath));
    press('', {downArrow: true}); press('d');
    await until(() => text().includes('approve removal'));
    expect((await loadConfig(home.configPath)).projects?.[rootPath]).toBeDefined();
    press('a'); await until(() => changed.mock.calls.length === 1);
    expect((await loadConfig(home.configPath)).projects?.[rootPath]).toBeUndefined();
  });
});
