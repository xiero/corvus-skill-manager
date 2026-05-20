import React, {useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  type ManagerConfig,
  type SkillpackConfig,
  type SkillpackInspection,
  type SkillpackRemoteUpdateInspection,
  type SkillpackUpdateApplyResult,
  type SkillpackUpdatePreview,
  type SkillpackSetupResult,
  applyInitialSkillpackSetup,
  applySkillpackUpdate,
  defaultSkillpackBranch,
  defaultSkillpackCheckoutPath,
  defaultSkillpackDisplayName,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl,
  inspectSkillpackCheckout,
  inspectSkillpackRemoteUpdate,
  parseSkillpackConfig,
  prepareSkillpackUpdatePreview,
  saveConfig
} from '@corvus-tools/skill-manager-core';
import {CommandBar, type CommandHint} from './CommandBar.js';

type FormField = 'id' | 'repositoryUrl' | 'branch' | 'checkoutPath';
type SetupMode = 'form' | 'preview' | 'preparing-update-preview' | 'update-preview' | 'applying-update' | 'update-result' | 'running' | 'result';

interface SkillpackFormState {
  id: string;
  repositoryUrl: string;
  branch: string;
  checkoutPath: string;
}

interface SkillpackEditSession {
  field: FormField;
  originalForm: SkillpackFormState;
}

export interface SkillpackSetupScreenProps {
  config: ManagerConfig;
  configPath: string;
  onBack: () => void;
  onConfigSaved: (config: ManagerConfig) => void;
}

const fields: Array<{key: FormField; label: string}> = [
  {key: 'id', label: 'Skillpack ID'},
  {key: 'repositoryUrl', label: 'Git repository'},
  {key: 'branch', label: 'Branch'},
  {key: 'checkoutPath', label: 'Active path'}
];

export function SkillpackSetupScreen({
  config,
  configPath,
  onBack,
  onConfigSaved
}: SkillpackSetupScreenProps): React.ReactElement {
  const [form, setForm] = useState<SkillpackFormState>(() => createInitialForm(config));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editSession, setEditSession] = useState<SkillpackEditSession | undefined>();
  const [mode, setMode] = useState<SetupMode>('form');
  const [inspection, setInspection] = useState<SkillpackInspection | undefined>();
  const [remoteUpdate, setRemoteUpdate] = useState<SkillpackRemoteUpdateInspection | undefined>();
  const [updatePreview, setUpdatePreview] = useState<SkillpackUpdatePreview | undefined>();
  const [updateResult, setUpdateResult] = useState<SkillpackUpdateApplyResult | undefined>();
  const [result, setResult] = useState<SkillpackSetupResult | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const selectedAction = selectedIndex - fields.length;
  const statusLine = useMemo(() => {
    if (errorMessage !== undefined) {
      return errorMessage;
    }

    if (mode === 'form' && config.skillpack === undefined) {
      return 'not configured';
    }

    if (mode === 'preview' && inspection === undefined) {
      return 'checking checkout';
    }

    if (mode === 'preview' && remoteUpdate?.updateAvailable === true) {
      return 'remote update available';
    }

    if (inspection !== undefined && mode === 'preview') {
      return statusMessageForInspection(inspection);
    }

    if (mode === 'preparing-update-preview') {
      return 'preparing update preview';
    }

    if (mode === 'update-preview') {
      return updatePreview?.status === 'update-preview-ready' ? 'update preview ready' : 'update preview unavailable';
    }

    if (mode === 'applying-update') {
      return 'activating update';
    }

    if (mode === 'update-result') {
      return updateResult?.status === 'update-applied' ? 'update applied' : 'update not applied';
    }

    if (mode === 'running') {
      return 'running setup';
    }

    if (result !== undefined) {
      return statusMessageForResult(result);
    }

    return 'configured';
  }, [config.skillpack, errorMessage, inspection, mode, remoteUpdate, result, updatePreview, updateResult]);
  const editingField = editSession?.field;

  useInput((input, key) => {
    if (mode === 'running' || mode === 'preparing-update-preview' || mode === 'applying-update') {
      return;
    }

    if (editSession !== undefined) {
      if (input === 'h' || input === 'q') {
        setForm(editSession.originalForm);
        setEditSession(undefined);
        return;
      }

      if (key.return) {
        setEditSession(undefined);
        return;
      }

      if (key.backspace || key.delete) {
        updateField(editSession.field, (value) => value.slice(0, -1));
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        updateField(editSession.field, (value) => `${value}${input}`);
      }

      return;
    }

    if (input === 'q' || input === 'h') {
      onBack();
      return;
    }

    if (mode === 'preview') {
      if (input === 'e') {
        setMode('form');
        setInspection(undefined);
        setRemoteUpdate(undefined);
        setUpdatePreview(undefined);
        setUpdateResult(undefined);
        setErrorMessage(undefined);
        return;
      }

      if (input === 'p') {
        void previewUpdate();
        return;
      }

      if (input === 'a') {
        void confirmSetup();
        return;
      }
    }

    if (mode === 'update-preview') {
      if (input === 'a') {
        void confirmUpdate();
        return;
      }

      if (input === 'e' || input === 'b') {
        setMode('preview');
      }

      return;
    }

    if (mode === 'update-result') {
      if (input === 'e') {
        setMode('form');
        setResult(undefined);
        setUpdatePreview(undefined);
        setUpdateResult(undefined);
        setErrorMessage(undefined);
      }

      return;
    }

    if (mode === 'result') {
      if (input === 'e') {
        setMode('form');
        setResult(undefined);
        setRemoteUpdate(undefined);
        setUpdatePreview(undefined);
        setUpdateResult(undefined);
        setErrorMessage(undefined);
      }

      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((currentIndex) => Math.max(0, currentIndex - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((currentIndex) => Math.min(fields.length + 1, currentIndex + 1));
      return;
    }

    if (key.return) {
      if (selectedIndex < fields.length) {
        const selectedField = fields[selectedIndex];

        if (selectedField !== undefined) {
          setEditSession({
            field: selectedField.key,
            originalForm: form
          });
        }

        return;
      }

      if (selectedAction === 0) {
        void previewSetup();
        return;
      }

      onBack();
    }
  });

  function updateField(field: FormField, updater: (value: string) => string): void {
    setForm((currentForm) => {
      const updatedValue = updater(currentForm[field]);
      const updatedForm = {
        ...currentForm,
        [field]: updatedValue
      };

      if (field === 'id' && currentForm.checkoutPath === defaultSkillpackCheckoutPath(currentForm.id)) {
        return {
          ...updatedForm,
          checkoutPath: defaultSkillpackCheckoutPath(updatedValue)
        };
      }

      return updatedForm;
    });
  }

  async function previewSetup(): Promise<void> {
    try {
      const skillpackConfig = parseForm();
      setMode('preview');
      setInspection(undefined);
      setRemoteUpdate(undefined);
      setUpdatePreview(undefined);
      setUpdateResult(undefined);
      setResult(undefined);
      setErrorMessage(undefined);
      const nextInspection = await inspectSkillpackCheckout(skillpackConfig.checkoutPath);
      setInspection(nextInspection);
      setRemoteUpdate(await inspectSkillpackRemoteUpdate(skillpackConfig));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function previewUpdate(): Promise<void> {
    try {
      const skillpackConfig = parseForm();
      setMode('preparing-update-preview');
      setUpdatePreview(undefined);
      setUpdateResult(undefined);
      setErrorMessage(undefined);
      setUpdatePreview(
        await prepareSkillpackUpdatePreview({
          config: skillpackConfig,
          managerStateDir: config.managerStateDir
        })
      );
      setMode('update-preview');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setMode('preview');
    }
  }

  async function confirmUpdate(): Promise<void> {
    try {
      const skillpackConfig = parseForm();
      const updatedConfig: ManagerConfig = {
        ...config,
        skillpack: skillpackConfig,
        updatedAt: new Date().toISOString()
      };

      setMode('applying-update');
      setErrorMessage(undefined);
      await saveConfig(updatedConfig, {configPath});
      onConfigSaved(updatedConfig);
      setUpdateResult(
        await applySkillpackUpdate({
          config: skillpackConfig,
          managerStateDir: config.managerStateDir
        })
      );
      setMode('update-result');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setMode('update-preview');
    }
  }

  async function confirmSetup(): Promise<void> {
    try {
      const skillpackConfig = parseForm();
      const updatedConfig: ManagerConfig = {
        ...config,
        skillpack: skillpackConfig,
        updatedAt: new Date().toISOString()
      };

      setMode('running');
      setErrorMessage(undefined);
      setUpdatePreview(undefined);
      setUpdateResult(undefined);
      await saveConfig(updatedConfig, {configPath});
      onConfigSaved(updatedConfig);
      setResult(
        await applyInitialSkillpackSetup({
          config: skillpackConfig,
          managerStateDir: config.managerStateDir
        })
      );
      setMode('result');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setMode('preview');
    }
  }

  function parseForm(): SkillpackConfig {
    return parseSkillpackConfig({
      id: form.id.trim(),
      repositoryUrl: form.repositoryUrl.trim(),
      branch: form.branch.trim(),
      checkoutPath: form.checkoutPath.trim()
    });
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Setup Skillpack</Text>
        <Text>
          Status: <Text color={errorMessage === undefined ? 'cyan' : 'red'}>{statusLine}</Text>
        </Text>
      </Box>

      <Box flexDirection="column">
        {fields.map((field, index) => {
          const selected = mode === 'form' && selectedIndex === index;
          const editing = editingField === field.key;
          const value = form[field.key] === '' ? '(empty)' : form[field.key];
          const displayValue = displayFieldValue(field.key, value, editing);
          const valueText =
            form[field.key] === '' ? <Text color="yellow">{displayValue}</Text> : <Text>{displayValue}</Text>;
          const fieldText = (
            <>
              {selected ? '>' : ' '} {field.label}: {editing ? '[' : ''}
              {valueText}
              {editing ? ']' : ''}
            </>
          );

          return selected ? (
            <Text key={field.key} color="cyan">
              {fieldText}
            </Text>
          ) : (
            <Text key={field.key}>{fieldText}</Text>
          );
        })}
      </Box>

      {mode === 'preview' ? (
        inspection === undefined ? <Preview /> : <Preview inspection={inspection} remoteUpdate={remoteUpdate} />
      ) : null}
      {mode === 'preparing-update-preview' ? <Text>Preparing inactive revision snapshot for preview...</Text> : null}
      {mode === 'update-preview' && updatePreview !== undefined ? <UpdatePreview preview={updatePreview} /> : null}
      {mode === 'update-result' && updateResult !== undefined ? <UpdateResult result={updateResult} /> : null}
      {mode === 'result' && result !== undefined ? <Result result={result} /> : null}

      <Box flexDirection="column">
        {mode === 'form' ? (
          <>
            {selectedAction === 0 ? <Text color="cyan">&gt; Preview setup</Text> : <Text>  Preview setup</Text>}
            {selectedAction === 1 ? <Text color="cyan">&gt; Back Home</Text> : <Text>  Back Home</Text>}
          </>
        ) : null}
      </Box>

      <CommandBar hints={helpHints(mode, editingField)} />
    </Box>
  );
}

function createInitialForm(config: ManagerConfig): SkillpackFormState {
  const id = config.skillpack?.id ?? defaultSkillpackId;

  return {
    id,
    repositoryUrl: config.skillpack?.repositoryUrl ?? defaultSkillpackRepositoryUrl,
    branch: config.skillpack?.branch ?? defaultSkillpackBranch,
    checkoutPath: config.skillpack?.checkoutPath ?? defaultSkillpackCheckoutPath(id)
  };
}

function displayFieldValue(field: FormField, value: string, editing: boolean): string {
  if (field === 'repositoryUrl' && value === defaultSkillpackRepositoryUrl && !editing) {
    return defaultSkillpackDisplayName;
  }

  return value;
}

function Preview({
  inspection,
  remoteUpdate
}: {
  inspection?: SkillpackInspection | undefined;
  remoteUpdate?: SkillpackRemoteUpdateInspection | undefined;
}): React.ReactElement {
  if (inspection === undefined) {
    return <Text>Preview: checking active path...</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Preview</Text>
      <Text>Active path: {inspection.checkoutPath}</Text>
      <Text>
        {inspection.exists ? 'Active snapshot exists; setup will inspect only unless you preview an update.' : 'Active snapshot missing; setup will create the initial revision snapshot.'}
      </Text>
      {remoteUpdate === undefined ? <Text dimColor>Remote update check pending...</Text> : (
        <Text color={remoteUpdate.updateAvailable ? 'yellow' : remoteUpdate.status === 'remote-unavailable' ? 'red' : 'green'}>
          {remoteUpdate.message}
        </Text>
      )}
      {inspection.dirtyFiles.length > 0 ? <Text color="yellow">Dirty files: {inspection.dirtyFiles.join(', ')}</Text> : null}
    </Box>
  );
}

function UpdatePreview({preview}: {preview: SkillpackUpdatePreview}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Update Preview</Text>
      <Text color={preview.status === 'update-preview-ready' ? 'green' : 'yellow'}>{preview.message}</Text>
      <Text>Active commit: {preview.activeCommitHash ?? '(unknown)'}</Text>
      <Text>Remote commit: {preview.remoteCommitHash ?? '(unknown)'}</Text>
      {preview.candidateRevisionPath === undefined ? null : <Text>Preview snapshot: {preview.candidateRevisionPath}</Text>}
      <Text>Added skills: {formatSkillList(preview.addedSkillIds)}</Text>
      <Text>Changed skills: {formatSkillList(preview.changedSkillIds)}</Text>
      <Text>Removed skills: {formatSkillList(preview.removedSkillIds)}</Text>
      {preview.changedFiles.length === 0 ? null : (
        <Text dimColor>Changed files: {preview.changedFiles.slice(0, 6).join(', ')}{preview.changedFiles.length > 6 ? '...' : ''}</Text>
      )}
    </Box>
  );
}

function UpdateResult({result}: {result: SkillpackUpdateApplyResult}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Update Result</Text>
      <Text color={result.status === 'update-applied' ? 'green' : result.status === 'update-failed' ? 'red' : 'yellow'}>
        {result.message}
      </Text>
      {result.previousCommitHash === undefined ? null : <Text>Previous commit: {result.previousCommitHash}</Text>}
      {result.commitHash === undefined ? null : <Text>Active commit: {result.commitHash}</Text>}
      {result.activeRevisionPath === undefined ? null : <Text>Active revision: {result.activeRevisionPath}</Text>}
      {result.lockPath === undefined ? null : <Text>Lock file: {result.lockPath}</Text>}
    </Box>
  );
}

function Result({result}: {result: SkillpackSetupResult}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Result</Text>
      <Text>{statusMessageForResult(result)}</Text>
      {result.activeRevisionPath === undefined ? null : <Text>Active revision: {result.activeRevisionPath}</Text>}
      {result.commitHash === undefined ? null : <Text>Commit: {result.commitHash}</Text>}
      {result.lockPath === undefined ? null : <Text>Lock file: {result.lockPath}</Text>}
      {result.dirtyFiles.length > 0 ? <Text color="yellow">Dirty files: {result.dirtyFiles.join(', ')}</Text> : null}
    </Box>
  );
}

function formatSkillList(skillIds: string[]): string {
  return skillIds.length === 0 ? '(none)' : skillIds.join(', ');
}

function statusMessageForInspection(inspection: SkillpackInspection): string {
  if (inspection.status === 'checkout-missing') {
    return 'checkout missing';
  }

  if (inspection.status === 'checkout-dirty') {
    return 'checkout dirty';
  }

  if (inspection.status === 'checkout-readable') {
    return 'checkout readable';
  }

  return 'checkout exists but is not readable';
}

function statusMessageForResult(result: SkillpackSetupResult): string {
  if (result.status === 'clone-complete') {
    return 'initial revision snapshot active';
  }

  if (result.status === 'clone-failed') {
    return `clone failed: ${result.message}`;
  }

  if (result.status === 'checkout-dirty') {
    return 'checkout dirty; inspected without modifying it';
  }

  if (result.status === 'checkout-readable') {
    return 'checkout readable; inspected without modifying it';
  }

  if (result.status === 'checkout-missing') {
    return 'checkout missing';
  }

  return result.message;
}

function helpHints(mode: SetupMode, editingField: FormField | undefined): CommandHint[] {
  if (editingField !== undefined) {
    return [
      {key: 'type', label: 'edit'},
      {key: 'backspace', label: 'delete'},
      {key: 'enter', label: 'finish'},
      {key: 'h/q', label: 'cancel'}
    ];
  }

  if (mode === 'preview') {
    return [
      {key: 'a', label: 'setup/inspection apply', tone: 'apply'},
      {key: 'p', label: 'preview remote update'},
      {key: 'e', label: 'edit'},
      {key: 'h/q', label: 'Home'}
    ];
  }

  if (mode === 'preparing-update-preview') {
    return [{key: 'wait', label: 'preparing update preview'}];
  }

  if (mode === 'update-preview') {
    return [
      {key: 'a', label: 'activate revision', tone: 'apply'},
      {key: 'b/e', label: 'return'},
      {key: 'h/q', label: 'Home'}
    ];
  }

  if (mode === 'applying-update') {
    return [{key: 'wait', label: 'activating selected revision'}];
  }

  if (mode === 'update-result') {
    return [
      {key: 'e', label: 'edit'},
      {key: 'h/q', label: 'Home'}
    ];
  }

  if (mode === 'result') {
    return [
      {key: 'e', label: 'edit'},
      {key: 'h/q', label: 'Home'}
    ];
  }

  if (mode === 'running') {
    return [{key: 'wait', label: 'working'}];
  }

  return [
    {key: 'up/down', label: 'move'},
    {key: 'j/k', label: 'move'},
    {key: 'enter', label: 'edit/select'},
    {key: 'h/q', label: 'Home'}
  ];
}
