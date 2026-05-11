import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  defaultConfigPath,
  defaultManagerStateDir,
  defaultSkillpackCheckoutPath,
  defaultSkillpackCurrentPath,
  defaultSkillpackRevisionsPath,
  defaultSkillpackRootPath,
  expandTilde,
  resolveUserPath
} from './paths.js';

describe('paths', () => {
  it('expands a bare tilde to the provided home directory', () => {
    expect(expandTilde('~', '/tmp/example-home')).toBe('/tmp/example-home');
  });

  it('expands tilde-prefixed paths safely', () => {
    expect(expandTilde('~/.agents/corvus-skill-manager', '/tmp/example-home')).toBe(
      path.join('/tmp/example-home', '.agents', 'corvus-skill-manager')
    );
  });

  it('does not expand named-user tilde paths', () => {
    expect(expandTilde('~someone/.agents', '/tmp/example-home')).toBe('~someone/.agents');
  });

  it('resolves default manager paths inside the provided home directory', () => {
    expect(defaultManagerStateDir('/tmp/example-home')).toBe(
      path.join('/tmp/example-home', '.agents', 'corvus-skill-manager')
    );
    expect(defaultConfigPath('/tmp/example-home')).toBe(
      path.join('/tmp/example-home', '.agents', 'corvus-skill-manager', 'config.json')
    );
    expect(resolveUserPath('~/.agents/corvus-skill-manager', '/tmp/example-home')).toBe(
      path.join('/tmp/example-home', '.agents', 'corvus-skill-manager')
    );
  });

  it('resolves the default skillpack snapshot paths by skillpack id', () => {
    expect(defaultSkillpackRootPath('corvus-skills', '/tmp/example-home')).toBe(
      path.join('/tmp/example-home', '.agents', 'skillpacks', 'corvus-skills')
    );
    expect(defaultSkillpackRevisionsPath('corvus-skills', '/tmp/example-home')).toBe(
      path.join('/tmp/example-home', '.agents', 'skillpacks', 'corvus-skills', 'revisions')
    );
    expect(defaultSkillpackCurrentPath('corvus-skills', '/tmp/example-home')).toBe(
      path.join('/tmp/example-home', '.agents', 'skillpacks', 'corvus-skills', 'current')
    );
    expect(defaultSkillpackCheckoutPath('corvus-skills', '/tmp/example-home')).toBe(
      path.join('/tmp/example-home', '.agents', 'skillpacks', 'corvus-skills', 'current')
    );
  });
});
