import React, {useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  type ManagerConfig,
  type SkillpackConfig,
  type SkillpackInspection,
  type SkillpackSetupResult,
  applyInitialSkillpackSetup,
  defaultSkillpackCheckoutPath,
  inspectSkillpackCheckout,
  parseSkillpackConfig,
  saveConfig
} from '@corvus-skill-manager/core';

type FormField = 'id' | 'repositoryUrl' | 'branch' | 'checkoutPath';
type SetupMode = 'form' | 'preview' | 'running' | 'result';

interface SkillpackFormState {
  id: string;
  repositoryUrl: string;
  branch: string;
  checkoutPath: string;
}

export interface SkillpackSetupScreenProps {
  config: ManagerConfig;
  configPath: string;
  onBack: () => void;
  onConfigSaved: (config: ManagerConfig) => void;
}

const fields: Array<{key: FormField; label: string}> = [
  {key: 'id', label: 'Skillpack ID'},
  {key: 'repositoryUrl', label: 'Git repository URL'},
  {key: 'branch', label: 'Branch'},
  {key: 'checkoutPath', label: 'Checkout path'}
];

export function SkillpackSetupScreen({
  config,
  configPath,
  onBack,
  onConfigSaved
}: SkillpackSetupScreenProps): React.ReactElement {
  const [form, setForm] = useState<SkillpackFormState>(() => createInitialForm(config));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingField, setEditingField] = useState<FormField | undefined>();
  const [mode, setMode] = useState<SetupMode>('form');
  const [inspection, setInspection] = useState<SkillpackInspection | undefined>();
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

    if (inspection !== undefined && mode === 'preview') {
      return statusMessageForInspection(inspection);
    }

    if (mode === 'running') {
      return 'running setup';
    }

    if (result !== undefined) {
      return statusMessageForResult(result);
    }

    return 'configured';
  }, [config.skillpack, errorMessage, inspection, mode, result]);

  useInput((input, key) => {
    if (mode === 'running') {
      return;
    }

    if (editingField !== undefined) {
      if (key.return) {
        setEditingField(undefined);
        return;
      }

      if (key.backspace || key.delete) {
        updateField(editingField, (value) => value.slice(0, -1));
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        updateField(editingField, (value) => `${value}${input}`);
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
        setErrorMessage(undefined);
        return;
      }

      if (input === 'c') {
        void confirmSetup();
        return;
      }
    }

    if (mode === 'result') {
      if (input === 'e') {
        setMode('form');
        setResult(undefined);
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
          setEditingField(selectedField.key);
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
      setResult(undefined);
      setErrorMessage(undefined);
      setInspection(await inspectSkillpackCheckout(skillpackConfig.checkoutPath));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
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
          const valueText =
            form[field.key] === '' ? <Text color="yellow">{value}</Text> : <Text>{value}</Text>;
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

      {mode === 'preview' ? inspection === undefined ? <Preview /> : <Preview inspection={inspection} /> : null}
      {mode === 'result' && result !== undefined ? <Result result={result} /> : null}

      <Box flexDirection="column">
        {mode === 'form' ? (
          <>
            {selectedAction === 0 ? <Text color="cyan">&gt; Preview setup</Text> : <Text>  Preview setup</Text>}
            {selectedAction === 1 ? <Text color="cyan">&gt; Back Home</Text> : <Text>  Back Home</Text>}
          </>
        ) : null}
      </Box>

      <Text dimColor>{helpText(mode, editingField)}</Text>
    </Box>
  );
}

function createInitialForm(config: ManagerConfig): SkillpackFormState {
  const id = config.skillpack?.id ?? 'corvus-skills';

  return {
    id,
    repositoryUrl: config.skillpack?.repositoryUrl ?? '',
    branch: config.skillpack?.branch ?? 'main',
    checkoutPath: config.skillpack?.checkoutPath ?? defaultSkillpackCheckoutPath(id)
  };
}

function Preview({inspection}: {inspection?: SkillpackInspection}): React.ReactElement {
  if (inspection === undefined) {
    return <Text>Preview: checking checkout path...</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Preview</Text>
      <Text>Checkout path: {inspection.checkoutPath}</Text>
      <Text>{inspection.exists ? 'Checkout exists; setup will inspect only.' : 'Checkout missing; setup will run initial clone.'}</Text>
      {inspection.dirtyFiles.length > 0 ? <Text color="yellow">Dirty files: {inspection.dirtyFiles.join(', ')}</Text> : null}
    </Box>
  );
}

function Result({result}: {result: SkillpackSetupResult}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Result</Text>
      <Text>{statusMessageForResult(result)}</Text>
      {result.commitHash === undefined ? null : <Text>Commit: {result.commitHash}</Text>}
      {result.lockPath === undefined ? null : <Text>Lock file: {result.lockPath}</Text>}
      {result.dirtyFiles.length > 0 ? <Text color="yellow">Dirty files: {result.dirtyFiles.join(', ')}</Text> : null}
    </Box>
  );
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
    return 'initial clone complete';
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

function helpText(mode: SetupMode, editingField: FormField | undefined): string {
  if (editingField !== undefined) {
    return 'Type to edit, backspace to delete, enter to finish editing.';
  }

  if (mode === 'preview') {
    return 'Press c to confirm, e to edit, h or q for Home.';
  }

  if (mode === 'result') {
    return 'Press e to edit, h or q for Home.';
  }

  if (mode === 'running') {
    return 'Working...';
  }

  return 'Use up/down or j/k, enter to edit/select, h or q for Home.';
}
