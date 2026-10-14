import {
  type SkillpackConfig,
  qualifyBundleId,
  qualifySkillId,
  resolveSkillReference
} from '../config/configSchema.js';
import {
  type SkillDiscoveryIssue,
  type SkillDiscoveryResult,
  discoverSkillsFromCheckout
} from '../skills/skillDiscovery.js';

/** One configured repository's contribution to an aggregate catalog. */
export interface SkillpackCatalogDiscovery {
  config: SkillpackConfig;
  discovery?: SkillDiscoveryResult;
  unavailableMessage?: string;
  failure?: SkillDiscoveryIssue;
}

/** Reads only the supplied repositories, without loading or changing manager state. */
export async function discoverSkillpacks(
  skillpacks: readonly SkillpackConfig[],
  discover: typeof discoverSkillsFromCheckout = discoverSkillsFromCheckout
): Promise<SkillDiscoveryResult> {
  const discoveries = await Promise.all(skillpacks.map(async (config): Promise<SkillpackCatalogDiscovery> => {
    try {
      return {config, discovery: qualifySkillpackDiscovery(config.id, await discover(config.checkoutPath))};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        config,
        unavailableMessage: message,
        failure: {
          severity: 'error',
          code: 'skillpack-discovery-failed',
          skillpackId: config.id,
          message: `Skillpack "${config.id}": could not read its skills: ${message}`,
          path: config.checkoutPath
        }
      };
    }
  }));

  return aggregateSkillpackDiscoveries(discoveries);
}

/** Filters the visible catalog without modifying the full catalog used for planning. */
export function filterSkillpackDiscovery(
  discovery: SkillDiscoveryResult,
  skillpackIds: readonly string[]
): SkillDiscoveryResult {
  const selected = new Set(skillpackIds);
  const skillpacks = (discovery.skillpacks ?? []).filter((item) => selected.has(item.id));
  const catalogs = skillpacks.filter((item) => item.source !== undefined);
  const skills = discovery.skills.filter((skill) => skill.skillpackId !== undefined && selected.has(skill.skillpackId));
  const bundles = discovery.bundles.filter((bundle) => bundle.skillpackId !== undefined && selected.has(bundle.skillpackId));
  const single = catalogs.length === 1 ? catalogs[0] : undefined;

  return {
    skillpackRoot: single?.skillpackRoot ?? single?.checkoutPath ?? (skillpacks.length === 0 ? '(no skillpacks)' : '(multiple skillpacks)'),
    registryPath: single?.registryPath ?? (skillpacks.length === 0 ? '(no registries)' : '(multiple registries)'),
    source: catalogs.length > 0 && catalogs.every((item) => item.source === 'registry') ? 'registry' : 'registryless',
    ...(single?.registryVersion === undefined ? {} : {registryVersion: single.registryVersion}),
    registryCounts: {
      skillCount: skillpacks.reduce((total, item) => total + (item.registryCounts?.skillCount ?? item.skillCount), 0),
      versionedSkillCount: skillpacks.reduce((total, item) => total + (item.registryCounts?.versionedSkillCount ?? 0), 0),
      bundleCount: skillpacks.reduce((total, item) => total + (item.registryCounts?.bundleCount ?? item.bundleCount), 0),
      validBundleMembershipCount: skillpacks.reduce((total, item) => total + (item.registryCounts?.validBundleMembershipCount ?? 0), 0)
    },
    skills,
    bundles,
    warnings: discovery.warnings.filter((issue) => issue.skillpackId !== undefined && selected.has(issue.skillpackId)),
    errors: discovery.errors.filter((issue) => issue.skillpackId !== undefined && selected.has(issue.skillpackId)),
    skillpacks
  };
}

/** Keeps local IDs intact while assigning repository-scoped selection identities. */
export function qualifySkillpackDiscovery(
  skillpackId: string,
  discovery: SkillDiscoveryResult
): SkillDiscoveryResult {
  return {
    ...discovery,
    skills: discovery.skills.map((skill) => ({
      ...skill,
      skillpackId,
      ref: qualifySkillId(skillpackId, skill.id),
      requires: (skill.requires ?? []).map((id) => resolveSkillReference(id, skillpackId)),
      recommends: (skill.recommends ?? []).map((id) => resolveSkillReference(id, skillpackId)),
      conflictsWith: (skill.conflictsWith ?? []).map((id) => resolveSkillReference(id, skillpackId)),
      riskWarnings: (skill.riskWarnings ?? []).map((issue) => qualifyIssue(skillpackId, issue))
    })),
    bundles: (discovery.bundles ?? []).map((bundle) => ({
      ...bundle,
      skillpackId,
      ref: qualifyBundleId(skillpackId, bundle.id),
      members: bundle.members.map((member) => ({
        ...member,
        ref: resolveSkillReference(member.ref ?? member.id, skillpackId)
      }))
    })),
    warnings: discovery.warnings.map((issue) => qualifyIssue(skillpackId, issue)),
    errors: discovery.errors.map((issue) => qualifyIssue(skillpackId, issue))
  };
}

/** Shared by in-memory catalog discovery and reports that also inspect checkout state. */
export function aggregateSkillpackDiscoveries(
  skillpacks: readonly SkillpackCatalogDiscovery[]
): SkillDiscoveryResult {
  const discoveries = skillpacks.flatMap((item) => item.discovery === undefined ? [] : [item.discovery]);
  const single = discoveries.length === 1 ? discoveries[0] : undefined;

  return {
    skillpackRoot: single?.skillpackRoot ?? (skillpacks.length === 0 ? '(no skillpacks)' : '(multiple skillpacks)'),
    registryPath: single?.registryPath ?? (skillpacks.length === 0 ? '(no registries)' : '(multiple registries)'),
    source: discoveries.length > 0 && discoveries.every((item) => item.source === 'registry') ? 'registry' : 'registryless',
    ...(single?.registryVersion === undefined ? {} : {registryVersion: single.registryVersion}),
    registryCounts: {
      skillCount: discoveries.reduce((total, item) => total + (item.registryCounts?.skillCount ?? item.skills.length), 0),
      versionedSkillCount: discoveries.reduce((total, item) => total + (item.registryCounts?.versionedSkillCount ?? 0), 0),
      bundleCount: discoveries.reduce((total, item) => total + (item.registryCounts?.bundleCount ?? item.bundles.length), 0),
      validBundleMembershipCount: discoveries.reduce((total, item) => total + (item.registryCounts?.validBundleMembershipCount ?? 0), 0)
    },
    skills: discoveries.flatMap((item) => item.skills).sort((left, right) =>
      (left.ref ?? left.id).localeCompare(right.ref ?? right.id)
    ),
    bundles: discoveries.flatMap((item) => item.bundles).sort((left, right) =>
      (left.ref ?? left.id).localeCompare(right.ref ?? right.id)
    ),
    warnings: [
      ...discoveries.flatMap((item) => item.warnings),
      ...skillpacks.filter((item) => item.discovery === undefined && item.failure === undefined).map((item) => ({
        severity: 'warning' as const,
        code: 'skillpack-not-ready',
        skillpackId: item.config.id,
        message: `Skillpack "${item.config.id}" is not available to the aggregate catalog: ${item.unavailableMessage ?? 'Checkout is unavailable'}.`,
        path: item.config.checkoutPath
      }))
    ],
    errors: [
      ...discoveries.flatMap((item) => item.errors),
      ...skillpacks.flatMap((item) => item.failure === undefined ? [] : [item.failure])
    ],
    skillpacks: skillpacks.map((item) => ({
      id: item.config.id,
      checkoutPath: item.config.checkoutPath,
      ready: item.discovery !== undefined && item.unavailableMessage === undefined,
      ...(item.discovery?.skillpackRoot === undefined ? {} : {skillpackRoot: item.discovery.skillpackRoot}),
      ...(item.discovery?.registryPath === undefined ? {} : {registryPath: item.discovery.registryPath}),
      ...(item.discovery?.source === undefined ? {} : {source: item.discovery.source}),
      ...(item.discovery?.registryVersion === undefined ? {} : {registryVersion: item.discovery.registryVersion}),
      ...(item.discovery?.registryCounts === undefined ? {} : {registryCounts: item.discovery.registryCounts}),
      skillCount: item.discovery?.skills.length ?? 0,
      bundleCount: item.discovery?.bundles.length ?? 0,
      warningCount: item.discovery?.warnings.length ?? 0,
      errorCount: (item.discovery?.errors.length ?? 0) + (item.failure === undefined ? 0 : 1),
      ...(item.unavailableMessage === undefined ? {} : {message: item.unavailableMessage})
    }))
  };
}

function qualifyIssue<T extends SkillDiscoveryIssue>(skillpackId: string, issue: T): T {
  return {
    ...issue,
    skillpackId,
    message: issue.skillpackId === skillpackId ? issue.message : `Skillpack "${skillpackId}": ${issue.message}`
  };
}
