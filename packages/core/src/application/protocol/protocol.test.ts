import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {canonicalJsonStringify} from './canonicalJson.js';
import {
  createFailureEnvelope,
  createSuccessEnvelope,
  exitCodeForEnvelope,
  machineCommands,
  machineEnvelopeSchema,
  machineProtocolVersion,
  parseMachineEnvelope,
  serializeEnvelope
} from './envelope.js';
import {
  categoryForErrorCode,
  createMachineError,
  createMachineWarning,
  exitCodeForErrorCode,
  machineErrorCodes,
  machineErrorFromUnknown
} from './errors.js';
import {exitCodeCategoryDescriptions, exitCodeForCategory, machineErrorCategories} from './exitCodes.js';
import {createNextAction, dedupeNextActions} from './nextActions.js';

describe('machine protocol envelopes', () => {
  it('validates a success envelope against the schema', () => {
    const envelope = createSuccessEnvelope({
      command: 'status',
      data: {configExists: false}
    });

    expect(machineEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope).toEqual({
      schemaVersion: 1,
      ok: true,
      command: 'status',
      changed: false,
      data: {configExists: false},
      warnings: [],
      errors: [],
      nextActions: []
    });
  });

  it('validates a failure envelope against the schema', () => {
    const envelope = createFailureEnvelope({
      command: 'install.plan',
      errors: [
        createMachineError('UNMANAGED_TARGET_EXISTS', 'Target exists and is not manager-owned.', {
          path: '/home/user/.agents/skills/example'
        })
      ]
    });

    expect(machineEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.ok).toBe(false);
    expect(envelope.errors[0]).toEqual({
      code: 'UNMANAGED_TARGET_EXISTS',
      category: 'conflict',
      message: 'Target exists and is not manager-owned.',
      retryable: false,
      path: '/home/user/.agents/skills/example'
    });
  });

  it('refuses to build a failure envelope without errors', () => {
    expect(() => createFailureEnvelope({command: 'status', errors: []})).toThrow(
      /requires at least one error/
    );
  });

  it('rejects unknown envelope fields and unknown commands', () => {
    expect(() =>
      parseMachineEnvelope({
        ...createSuccessEnvelope({command: 'status'}),
        extra: true
      })
    ).toThrow(z.ZodError);

    expect(() =>
      parseMachineEnvelope({
        ...createSuccessEnvelope({command: 'status'}),
        command: 'not.a.command'
      })
    ).toThrow(z.ZodError);
  });

  it('never emits undefined for omitted optional fields', () => {
    const error = createMachineError('SKILL_NOT_FOUND', 'No such skill.');
    const warning = createMachineWarning('missing-registry', 'No registry.json found.');

    expect(Object.keys(error).sort()).toEqual(['category', 'code', 'message', 'retryable']);
    expect(Object.keys(warning).sort()).toEqual(['code', 'message']);
    expect(serializeEnvelope(createFailureEnvelope({command: 'skills.inspect', errors: [error]}))).not.toContain(
      'undefined'
    );
  });
});

describe('deterministic serialization', () => {
  it('produces byte-identical output for equivalent envelopes with different key order', () => {
    const first = createSuccessEnvelope({
      command: 'skills.search',
      data: {query: 'embedded', results: [{id: 'a', score: 2}]}
    });
    const second: typeof first = {
      nextActions: [],
      errors: [],
      warnings: [],
      data: {results: [{score: 2, id: 'a'}], query: 'embedded'},
      changed: false,
      command: 'skills.search',
      ok: true,
      schemaVersion: machineProtocolVersion
    };

    expect(serializeEnvelope(first)).toBe(serializeEnvelope(second));
  });

  it('matches a golden serialization', () => {
    const envelope = createSuccessEnvelope({
      command: 'install.plan',
      changed: false,
      data: {planId: 'abc123'},
      warnings: [createMachineWarning('recommendation-not-selected', 'embedded-testing is recommended.')],
      nextActions: [createNextAction('apply-plan', 'Apply the reviewed plan.', 'install apply --plan-id abc123')]
    });

    expect(serializeEnvelope(envelope)).toBe(
      '{"changed":false,"command":"install.plan","data":{"planId":"abc123"},"errors":[],' +
        '"nextActions":[{"code":"apply-plan","command":"install apply --plan-id abc123",' +
        '"description":"Apply the reviewed plan."}],"ok":true,"schemaVersion":1,' +
        '"warnings":[{"code":"recommendation-not-selected","message":"embedded-testing is recommended."}]}'
    );
  });

  it('canonicalizes nested structures and drops undefined members', () => {
    expect(canonicalJsonStringify({b: 1, a: {d: undefined, c: [3, {f: 1, e: 2}]}})).toBe(
      '{"a":{"c":[3,{"e":2,"f":1}]},"b":1}'
    );
  });

  it('is stable when serialized repeatedly', () => {
    const envelope = createSuccessEnvelope({command: 'skills.list', data: {skills: [{id: 'b'}, {id: 'a'}]}});

    expect(serializeEnvelope(envelope)).toBe(serializeEnvelope(envelope));
  });
});

describe('exit-code mapping', () => {
  it('maps every error code to exactly one stable category', () => {
    for (const code of machineErrorCodes) {
      const category = categoryForErrorCode(code);

      expect(machineErrorCategories).toContain(category);
      expect(categoryForErrorCode(code)).toBe(category);
      expect(exitCodeForErrorCode(code)).toBe(exitCodeForCategory(category));
    }
  });

  it('uses the documented category numbers', () => {
    expect(exitCodeForCategory('invalid-request')).toBe(2);
    expect(exitCodeForCategory('conflict')).toBe(3);
    expect(exitCodeForCategory('confirmation')).toBe(4);
    expect(exitCodeForCategory('safety')).toBe(5);
    expect(exitCodeForCategory('external')).toBe(6);
    expect(exitCodeForCategory('internal')).toBe(7);
  });

  it('describes every category exactly once, plus success', () => {
    const described = exitCodeCategoryDescriptions.map((entry) => entry.category);

    expect(described).toEqual(['success', ...machineErrorCategories]);
    expect(new Set(exitCodeCategoryDescriptions.map((entry) => entry.exitCode)).size).toBe(
      exitCodeCategoryDescriptions.length
    );
  });

  it('exits 0 for success envelopes and the first error category otherwise', () => {
    expect(exitCodeForEnvelope(createSuccessEnvelope({command: 'status'}))).toBe(0);
    expect(
      exitCodeForEnvelope(
        createFailureEnvelope({
          command: 'install.apply',
          errors: [
            createMachineError('STALE_PLAN', 'Plan is stale.'),
            createMachineError('INTERNAL_ERROR', 'Should not decide the exit code.')
          ]
        })
      )
    ).toBe(4);
  });
});

describe('unknown-error sanitization', () => {
  it('keeps only the first line of an Error message and never a stack trace', () => {
    const error = new Error('boom\n    at somewhere.ts:1:1');
    const machineError = machineErrorFromUnknown(error);

    expect(machineError.message).toBe('boom');
    expect(machineError.code).toBe('INTERNAL_ERROR');
    expect(machineError.category).toBe('internal');
    expect(JSON.stringify(machineError)).not.toContain('at somewhere.ts');
  });

  it('formats Zod errors with field paths', () => {
    const parsed = z.object({name: z.string()}).safeParse({});

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(machineErrorFromUnknown(parsed.error, {code: 'INVALID_REQUEST'}).message).toContain('name:');
    }
  });

  it('falls back to a generic message for opaque values', () => {
    expect(machineErrorFromUnknown({weird: true}).message).toBe('Unexpected internal failure.');
    expect(machineErrorFromUnknown(null, {fallbackMessage: 'Custom fallback.'}).message).toBe('Custom fallback.');
  });

  it('marks only external failures retryable by default', () => {
    expect(createMachineError('EXTERNAL_OPERATION_FAILED', 'git failed').retryable).toBe(true);
    expect(createMachineError('INVALID_REQUEST', 'bad input').retryable).toBe(false);
  });
});

describe('next actions', () => {
  it('dedupes by code while preserving order', () => {
    const actions = dedupeNextActions([
      createNextAction('a', 'first'),
      createNextAction('b', 'second'),
      createNextAction('a', 'duplicate')
    ]);

    expect(actions.map((action) => action.code)).toEqual(['a', 'b']);
    expect(actions[0]?.description).toBe('first');
  });
});

describe('command identity', () => {
  it('lists unique, sorted-per-family command names', () => {
    expect(new Set(machineCommands).size).toBe(machineCommands.length);

    for (const command of machineCommands) {
      expect(command).toMatch(/^[a-z]+(\.[a-z-]+)?$/);
    }
  });
});
