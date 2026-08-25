import {promises as fs} from 'node:fs';
import path from 'node:path';

export interface SkillFixture {
  relativePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface SkillpackFixture {
  registry?: unknown;
  skills: SkillFixture[];
}

export async function writeSkillpack(rootPath: string, fixture: SkillpackFixture): Promise<void> {
  await fs.mkdir(rootPath, {recursive: true});

  if (fixture.registry !== undefined) {
    await fs.writeFile(
      path.join(rootPath, 'registry.json'),
      `${JSON.stringify(fixture.registry, null, 2)}\n`,
      'utf8'
    );
  }

  for (const skill of fixture.skills) {
    const skillPath = path.join(rootPath, skill.relativePath);
    await fs.mkdir(skillPath, {recursive: true});
    await fs.writeFile(
      path.join(skillPath, 'SKILL.md'),
      `---\n${toYaml(skill.frontmatter)}---\n\n${skill.body}\n`,
      'utf8'
    );
  }
}

function toYaml(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entryValue]) => `${key}: ${JSON.stringify(entryValue)}`)
    .join('\n')
    .concat('\n');
}

/**
 * A representative registry v2 skillpack spanning embedded, web, testing, documentation, and
 * general-development skills. Used by catalog/search/install tests and by CLI process tests so
 * intent-based discovery is exercised against realistic metadata rather than toy entries.
 */
export const v2SkillpackFixture: SkillpackFixture = {
  registry: {
    version: 2,
    skills: [
      {
        id: 'embedded-driver-development',
        path: 'skills/embedded-driver-development',
        title: 'Embedded Driver Development',
        description: 'Helps implement and review embedded C/C++ peripheral drivers.',
        supportedAgents: ['codex', 'claude'],
        tags: ['firmware'],
        domains: ['embedded', 'firmware'],
        tasks: ['driver-development', 'debugging', 'code-review'],
        languages: ['c', 'cpp'],
        technologies: ['cmake', 'gcc', 'stm32'],
        platforms: ['bare-metal', 'rtos'],
        keywords: ['hal', 'registers', 'interrupts', 'peripherals'],
        useCases: ['Implement a new peripheral driver'],
        nonGoals: ['General-purpose web application development'],
        requires: ['embedded-toolchain'],
        recommends: ['embedded-testing'],
        conflictsWith: []
      },
      {
        id: 'embedded-testing',
        path: 'skills/embedded-testing',
        title: 'Embedded Testing',
        description: 'Adds unit-testing and hardware abstraction guidance for firmware.',
        supportedAgents: ['codex', 'claude'],
        tags: ['firmware'],
        domains: ['embedded', 'testing'],
        tasks: ['testing', 'test-design'],
        languages: ['c', 'cpp'],
        technologies: ['ceedling', 'unity'],
        platforms: ['bare-metal'],
        keywords: ['mocks', 'fakes', 'hardware abstraction'],
        useCases: ['Add unit tests around a peripheral driver'],
        nonGoals: [],
        requires: [],
        recommends: [],
        conflictsWith: []
      },
      {
        id: 'embedded-toolchain',
        path: 'skills/embedded-toolchain',
        title: 'Embedded Toolchain',
        description: 'Configures cross-compilation toolchains and build files.',
        supportedAgents: ['codex', 'claude', 'gemini'],
        tags: ['firmware'],
        domains: ['embedded'],
        tasks: ['build-configuration'],
        languages: ['c', 'cpp'],
        technologies: ['cmake', 'gcc'],
        platforms: ['bare-metal'],
        keywords: ['linker', 'cross-compile'],
        useCases: ['Set up a cross-compilation toolchain'],
        nonGoals: [],
        requires: [],
        recommends: [],
        conflictsWith: []
      },
      {
        id: 'react-component-design',
        path: 'skills/react-component-design',
        title: 'React Component Design',
        description: 'Designs accessible, composable React components.',
        supportedAgents: ['codex', 'claude'],
        tags: ['frontend'],
        domains: ['web', 'frontend'],
        tasks: ['component-design', 'code-review'],
        languages: ['typescript', 'javascript'],
        technologies: ['react', 'vite'],
        platforms: ['browser'],
        keywords: ['hooks', 'props', 'accessibility'],
        useCases: ['Build a reusable React component'],
        nonGoals: ['Embedded firmware development'],
        requires: [],
        recommends: ['node-api-development'],
        conflictsWith: []
      },
      {
        id: 'node-api-development',
        path: 'skills/node-api-development',
        title: 'Node API Development',
        description: 'Implements and reviews Node.js HTTP APIs.',
        supportedAgents: ['codex'],
        tags: ['backend'],
        domains: ['web', 'backend'],
        tasks: ['api-development', 'debugging'],
        languages: ['typescript', 'javascript'],
        technologies: ['node', 'fastify'],
        platforms: ['server'],
        keywords: ['routing', 'middleware', 'validation'],
        useCases: ['Add an endpoint to a Node service'],
        nonGoals: [],
        requires: [],
        recommends: [],
        conflictsWith: []
      },
      {
        id: 'test-driven-development',
        path: 'skills/test-driven-development',
        title: 'Test Driven Development',
        description: 'Drives implementation with a red-green-refactor loop.',
        supportedAgents: ['codex', 'claude', 'gemini'],
        tags: ['quality'],
        domains: ['testing'],
        tasks: ['testing', 'test-design'],
        languages: ['typescript', 'python'],
        technologies: ['vitest', 'pytest'],
        platforms: [],
        keywords: ['red-green-refactor', 'regression'],
        useCases: ['Write a failing test before implementing a feature'],
        nonGoals: [],
        requires: [],
        recommends: [],
        conflictsWith: []
      },
      {
        id: 'technical-documentation',
        path: 'skills/technical-documentation',
        title: 'Technical Documentation',
        description: 'Writes and reviews reference and how-to documentation.',
        supportedAgents: ['codex', 'claude'],
        tags: ['docs'],
        domains: ['documentation'],
        tasks: ['documentation', 'code-review'],
        languages: ['markdown'],
        technologies: ['mkdocs'],
        platforms: [],
        keywords: ['reference', 'how-to', 'changelog'],
        useCases: ['Document a public API'],
        nonGoals: [],
        requires: [],
        recommends: [],
        conflictsWith: []
      },
      {
        id: 'git-commit',
        path: 'skills/git-commit',
        title: 'Git Commit',
        description: 'Writes clear conventional commit messages.',
        supportedAgents: ['codex', 'claude', 'copilot', 'gemini', 'opencode', 'pi'],
        tags: ['git'],
        domains: ['general-development'],
        tasks: ['version-control'],
        languages: [],
        technologies: ['git'],
        platforms: [],
        keywords: ['conventional commits', 'changelog'],
        useCases: ['Write a commit message for staged changes'],
        nonGoals: [],
        requires: [],
        recommends: [],
        conflictsWith: []
      }
    ]
  },
  skills: [
    skillFile('skills/embedded-driver-development', 'embedded-driver-development', 'Implement embedded drivers.'),
    skillFile('skills/embedded-testing', 'embedded-testing', 'Test embedded code.'),
    skillFile('skills/embedded-toolchain', 'embedded-toolchain', 'Configure embedded toolchains.'),
    skillFile('skills/react-component-design', 'react-component-design', 'Design React components.'),
    skillFile('skills/node-api-development', 'node-api-development', 'Build Node APIs.'),
    skillFile('skills/test-driven-development', 'test-driven-development', 'Practise TDD.'),
    skillFile('skills/technical-documentation', 'technical-documentation', 'Write documentation.'),
    skillFile('skills/git-commit', 'git-commit', 'Write commit messages.')
  ]
};

/** Registry v3 fixture used by bundle discovery/catalog tests while legacy v2 coverage remains. */
export const v3BundleSkillpackFixture: SkillpackFixture = {
  registry: {
    version: 3,
    skills: [
      {
        id: 'review-helper',
        version: '2.1.0',
        path: 'skills/review-helper',
        title: 'Review Helper',
        description: 'Helps review code changes.',
        supportedAgents: ['codex', 'claude'],
        tags: ['review'],
        domains: ['code-quality'],
        requires: [{id: 'git-basics', version: '^1.4.0'}]
      },
      {
        id: 'git-basics',
        version: '1.5.0',
        path: 'skills/git-basics',
        title: 'Git Basics',
        description: 'Provides Git fundamentals.',
        supportedAgents: ['codex'],
        tags: ['git']
      },
      {
        id: 'test-helper',
        version: '3.0.0-beta.1',
        path: 'skills/test-helper',
        title: 'Test Helper',
        description: 'Helps design focused tests.',
        supportedAgents: ['codex'],
        tags: ['testing']
      },
      {
        id: 'docs-helper',
        version: '1.0.0',
        path: 'skills/docs-helper',
        title: 'Docs Helper',
        description: 'Helps write technical documentation.',
        supportedAgents: ['codex', 'claude'],
        tags: ['documentation']
      }
    ],
    bundles: [
      {
        id: 'default',
        version: '1.2.0',
        title: 'Review Workflow',
        description: 'A maintained code review composition.',
        skills: [
          {id: 'review-helper', version: '~2.1.0'},
          {id: 'test-helper', version: '>=3.0.0-beta.1 <4.0.0'}
        ],
        tags: ['Review', 'review'],
        keywords: ['quality gate', 'pull request']
      },
      {
        id: 'documentation',
        version: '1.0.0',
        title: 'Documentation Set',
        description: 'A documentation-focused composition.',
        skills: [{id: 'docs-helper', version: '^1.0.0'}],
        tags: ['docs'],
        keywords: ['technical writing']
      }
    ]
  },
  skills: [
    skillFile('skills/review-helper', 'review-helper', 'Review code changes.'),
    skillFile('skills/git-basics', 'git-basics', 'Use Git fundamentals.'),
    skillFile('skills/test-helper', 'test-helper', 'Design focused tests.'),
    skillFile('skills/docs-helper', 'docs-helper', 'Write technical documentation.')
  ]
};

/** Candidate revision with representative semantic and selected-bundle changes. */
export const v3BundleSkillpackUpdateFixture: SkillpackFixture = (() => {
  const fixture = structuredClone(v3BundleSkillpackFixture);
  const registry = fixture.registry as {
    skills: Array<{id: string; version: string; description: string}>;
    bundles: Array<{
      id: string;
      version: string;
      skills: Array<{id: string; version: string}>;
    }>;
  };

  for (const skill of registry.skills) {
    if (skill.id === 'review-helper') skill.version = '3.0.0';
    if (skill.id === 'git-basics') skill.version = '1.6.0';
    if (skill.id === 'docs-helper') skill.version = '1.0.1';
  }

  const defaultBundle = registry.bundles.find((bundle) => bundle.id === 'default');
  if (defaultBundle !== undefined) {
    defaultBundle.version = '2.0.0';
    const reviewMember = defaultBundle.skills.find((member) => member.id === 'review-helper');
    if (reviewMember !== undefined) reviewMember.version = '^3.0.0';
    defaultBundle.skills.push({id: 'docs-helper', version: '^1.0.0'});
  }

  return fixture;
})();

function skillFile(relativePath: string, name: string, description: string): SkillFixture {
  return {
    relativePath,
    frontmatter: {name, description},
    body: `Guidance for ${name}.`
  };
}
