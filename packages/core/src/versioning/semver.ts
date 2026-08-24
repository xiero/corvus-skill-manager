import semver from 'semver';

declare const semanticVersionBrand: unique symbol;
declare const semanticVersionRangeBrand: unique symbol;

/** A canonical SemVer 2.0.0 string validated by `parseSemanticVersion`. */
export type SemanticVersion = string & {readonly [semanticVersionBrand]: true};

/** A non-empty strict node-semver range validated by `parseSemanticVersionRange`. */
export type SemanticVersionRange = string & {readonly [semanticVersionRangeBrand]: true};

export const semanticVersionValidationErrorCodes = [
  'INVALID_SEMANTIC_VERSION',
  'INVALID_SEMANTIC_VERSION_RANGE'
] as const;

export type SemanticVersionValidationErrorCode = (typeof semanticVersionValidationErrorCodes)[number];

/** Stable validation failure used by registry schemas and application diagnostics. */
export class SemanticVersionValidationError extends Error {
  constructor(
    public readonly code: SemanticVersionValidationErrorCode,
    public readonly input: string
  ) {
    const subject = code === 'INVALID_SEMANTIC_VERSION' ? 'semantic version' : 'semantic version range';
    super(`Invalid ${subject}: ${JSON.stringify(input)}.`);
    this.name = 'SemanticVersionValidationError';
  }
}

export const semanticVersionChangeKinds = ['major', 'minor', 'patch', 'same'] as const;

export type SemanticVersionChangeKind = (typeof semanticVersionChangeKinds)[number];

const strictOptions = {loose: false} as const;

/**
 * Parses one canonical SemVer 2.0.0 version.
 *
 * node-semver deliberately accepts a leading `v` for historical compatibility. Comparing the
 * complete parsed representation with the input closes that cleanup path while retaining valid
 * prerelease and build metadata.
 */
export function parseSemanticVersion(input: string): SemanticVersion {
  parseCanonicalNodeSemanticVersion(input);
  return input as SemanticVersion;
}

/** Validates a non-empty node-semver range without coercing or trimming the authored expression. */
export function parseSemanticVersionRange(input: string): SemanticVersionRange {
  if (input === '' || input.trim() !== input) {
    throw new SemanticVersionValidationError('INVALID_SEMANTIC_VERSION_RANGE', input);
  }

  try {
    new semver.Range(input, strictOptions);
  } catch {
    throw new SemanticVersionValidationError('INVALID_SEMANTIC_VERSION_RANGE', input);
  }

  return input as SemanticVersionRange;
}

/** Uses node-semver's standard prerelease opt-in rules. */
export function satisfiesSemanticVersionRange(version: string, range: string): boolean {
  const parsedVersion = parseSemanticVersion(version);
  const parsedRange = parseSemanticVersionRange(range);

  return semver.satisfies(parsedVersion, parsedRange, strictOptions);
}

/**
 * Classifies the significance of a version difference without treating direction as a separate
 * concern. Prerelease-only differences are patch-level; build metadata does not affect SemVer
 * precedence and is therefore `same`.
 */
export function classifySemanticVersionChange(
  leftVersion: string,
  rightVersion: string
): SemanticVersionChangeKind {
  const left = parseCanonicalNodeSemanticVersion(leftVersion);
  const right = parseCanonicalNodeSemanticVersion(rightVersion);

  if (left.compare(right) === 0) return 'same';
  if (left.major !== right.major) return 'major';
  if (left.minor !== right.minor) return 'minor';

  return 'patch';
}

function parseCanonicalNodeSemanticVersion(input: string): semver.SemVer {
  const parsed = parseNodeSemanticVersion(input);

  if (formatCompleteVersion(parsed) !== input) {
    throw new SemanticVersionValidationError('INVALID_SEMANTIC_VERSION', input);
  }

  return parsed;
}

function parseNodeSemanticVersion(input: string): semver.SemVer {
  try {
    return new semver.SemVer(input, strictOptions);
  } catch {
    throw new SemanticVersionValidationError('INVALID_SEMANTIC_VERSION', input);
  }
}

function formatCompleteVersion(version: semver.SemVer): string {
  return version.build.length === 0 ? version.version : `${version.version}+${version.build.join('.')}`;
}
