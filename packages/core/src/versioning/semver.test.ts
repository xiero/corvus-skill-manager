import {describe, expect, it} from 'vitest';
import {
  SemanticVersionValidationError,
  classifySemanticVersionChange,
  parseSemanticVersion,
  parseSemanticVersionRange,
  satisfiesSemanticVersionRange
} from './semver.js';

describe('parseSemanticVersion', () => {
  it.each([
    '1.0.0',
    '2.3.1',
    '0.0.0',
    '1.2.3-alpha',
    '1.2.3-alpha.1',
    '1.2.3+build.01',
    '1.2.3-rc.1+build.01'
  ])('accepts canonical SemVer %s', (version) => {
    expect(parseSemanticVersion(version)).toBe(version);
  });

  it.each([
    'v1.2.3',
    '=1.2.3',
    '1',
    '1.2',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    ' 1.2.3',
    '1.2.3 ',
    'not-a-version'
  ])('rejects loose or malformed version %s with a stable error', (version) => {
    expect(() => parseSemanticVersion(version)).toThrowError(
      expect.objectContaining({
        name: 'SemanticVersionValidationError',
        code: 'INVALID_SEMANTIC_VERSION',
        input: version,
        message: `Invalid semantic version: ${JSON.stringify(version)}.`
      })
    );
  });
});

describe('parseSemanticVersionRange', () => {
  it.each(['1.2.3', '^1.2.3', '~1.2.3', '>=1.2.3 <2.0.0', '*', '>=1.2.3-beta.1 <1.2.3'])(
    'accepts strict range %s',
    (range) => {
      expect(parseSemanticVersionRange(range)).toBe(range);
    }
  );

  it.each(['', ' ', ' ^1.2.3', '^1.2.3 ', 'not-a-range', '>=1.2.3 <'])(
    'rejects blank, untrimmed, or malformed range %s with a stable error',
    (range) => {
      expect(() => parseSemanticVersionRange(range)).toThrowError(
        expect.objectContaining({
          name: 'SemanticVersionValidationError',
          code: 'INVALID_SEMANTIC_VERSION_RANGE',
          input: range,
          message: `Invalid semantic version range: ${JSON.stringify(range)}.`
        })
      );
    }
  );
});

describe('satisfiesSemanticVersionRange', () => {
  it('supports exact, caret, tilde, and bounded ranges', () => {
    expect(satisfiesSemanticVersionRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesSemanticVersionRange('1.9.0', '^1.2.3')).toBe(true);
    expect(satisfiesSemanticVersionRange('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesSemanticVersionRange('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesSemanticVersionRange('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfiesSemanticVersionRange('1.5.0', '>=1.2.3 <2.0.0')).toBe(true);
  });

  it('uses the standard prerelease opt-in behavior', () => {
    expect(satisfiesSemanticVersionRange('1.2.3-beta.2', '>=1.2.3-beta.1 <1.2.3')).toBe(true);
    expect(satisfiesSemanticVersionRange('1.3.0-beta.1', '>=1.2.3 <2.0.0')).toBe(false);
    expect(satisfiesSemanticVersionRange('1.3.0', '>=1.2.3 <2.0.0')).toBe(true);
  });

  it('validates both inputs before matching', () => {
    expect(() => satisfiesSemanticVersionRange('v1.2.3', '^1.0.0')).toThrow(SemanticVersionValidationError);
    expect(() => satisfiesSemanticVersionRange('1.2.3', '')).toThrow(SemanticVersionValidationError);
  });
});

describe('classifySemanticVersionChange', () => {
  it.each([
    ['1.2.3', '2.0.0', 'major'],
    ['2.0.0', '1.9.9', 'major'],
    ['1.2.3', '1.3.0', 'minor'],
    ['1.3.0', '1.2.9', 'minor'],
    ['1.2.3', '1.2.4', 'patch'],
    ['1.2.3', '1.2.3', 'same'],
    ['1.2.3-beta.1', '1.2.3-beta.2', 'patch'],
    ['1.2.3-beta.2', '1.2.3', 'patch'],
    ['1.2.3', '2.0.0-beta.1', 'major'],
    ['1.2.3', '1.3.0-beta.1', 'minor'],
    ['1.2.3', '1.2.4-beta.1', 'patch'],
    ['1.2.3+build.1', '1.2.3+build.2', 'same']
  ] as const)('classifies %s -> %s as %s', (from, to, expected) => {
    expect(classifySemanticVersionChange(from, to)).toBe(expected);
  });
});
