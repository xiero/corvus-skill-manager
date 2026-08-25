import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  type AffectedBundleUpdate,
  type ManagerConfig,
  type RevisionEntityDelta,
  type SkillpackConfig,
  defaultSkillpackBranch,
  defaultSkillpackCheckoutPath,
  defaultSkillpackDisplayName,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl,
  getSkillpacks,
  parseSkillpackConfig
} from '@corvus-tools/skill-manager-core';
import {useCorvusApplication} from '../application/applicationContext.js';
import {describeMachineErrors} from '../application/errorMessages.js';
import {CommandBar, type CommandHint} from './CommandBar.js';
import {SemanticUpdateSummaryView} from './SemanticUpdatePreview.js';

type ScreenMode =
  | 'list'
  | 'details'
  | 'add'
  | 'edit'
  | 'planning-setup'
  | 'setup-preview'
  | 'applying-setup'
  | 'planning-update'
  | 'update-preview'
  | 'applying-update'
  | 'planning-remove'
  | 'remove-preview'
  | 'applying-remove'
  | 'result';

type FormField = 'repositoryUrl' | 'id' | 'branch' | 'checkoutPath';

interface SkillpackFormState {
  id: string;
  repositoryUrl: string;
  branch: string;
  checkoutPath: string;
  idCustomized: boolean;
  pathCustomized: boolean;
}

interface EditSession {
  field: FormField;
  originalForm: SkillpackFormState;
}

interface PackStatus {
  checkoutExists: boolean;
  checkoutReadable: boolean;
  updateAvailable?: boolean;
  currentCommit?: string;
  discoveredSkillCount: number;
}

interface SetupPreviewState {
  planId: string;
  candidate: SkillpackConfig;
  alreadyPresent: boolean;
  expectedRevisionPath?: string;
}

interface UpdatePreviewState {
  planId?: string;
  status: string;
  message: string;
  addedSkillIds: string[];
  changedSkillIds: string[];
  removedSkillIds: string[];
  skillDeltas: RevisionEntityDelta[];
  bundleDeltas: RevisionEntityDelta[];
  affectedBundles: AffectedBundleUpdate[];
}

export interface SkillpackSetupScreenProps {
  config: ManagerConfig;
  configPath: string;
  onBack: () => void;
  onConfigSaved: (config: ManagerConfig) => void;
}

const addFieldOrder: FormField[] = ['repositoryUrl', 'id', 'branch', 'checkoutPath'];
const editFieldOrder: FormField[] = ['repositoryUrl', 'branch', 'checkoutPath'];

export function SkillpackSetupScreen({
  config,
  configPath,
  onBack,
  onConfigSaved
}: SkillpackSetupScreenProps): React.ReactElement {
  const application = useCorvusApplication(configPath);
  const [localConfig, setLocalConfig] = useState(config);
  const [mode, setMode] = useState<ScreenMode>('list');
  const [listIndex, setListIndex] = useState(0);
  const [detailIndex, setDetailIndex] = useState(0);
  const [formIndex, setFormIndex] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState(defaultSkillpackId);
  const [form, setForm] = useState<SkillpackFormState>(() => createAddForm([]));
  const [editSession, setEditSession] = useState<EditSession | undefined>();
  const [statuses, setStatuses] = useState<Record<string, PackStatus>>({});
  const [setupPreview, setSetupPreview] = useState<SetupPreviewState | undefined>();
  const [updatePreview, setUpdatePreview] = useState<UpdatePreviewState | undefined>();
  const [removePlanId, setRemovePlanId] = useState<string | undefined>();
  const [resultMessage, setResultMessage] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => setLocalConfig(config), [config]);

  const configuredPacks = useMemo(() => displayedSkillpacks(localConfig), [localConfig]);
  const defaultPack = configuredPacks.find((pack) => pack.id === defaultSkillpackId);
  const additionalPacks = configuredPacks.filter((pack) => pack.id !== defaultSkillpackId);
  const orderedPacks = [...(defaultPack === undefined ? [] : [defaultPack]), ...additionalPacks];
  const selectedPack = orderedPacks.find((pack) => pack.id === selectedPackId);
  const visibleFields = mode === 'add' && !advanced ? ['repositoryUrl'] satisfies FormField[] : mode === 'edit' ? editFieldOrder : addFieldOrder;
  const formActions = mode === 'add'
    ? [advanced ? 'Hide advanced settings' : 'Advanced settings', 'Preview addition', 'Cancel']
    : ['Preview changes', 'Cancel'];
  const detailActions = selectedPack === undefined
    ? ['Back to repositories']
    : [
        'Edit settings',
        'Check for updates',
        ...(selectedPack.id === defaultSkillpackId ? [] : ['Remove registration']),
        'Back to repositories'
      ];

  useEffect(() => {
    let active = true;
    void application.skillpackStatus().then((result) => {
      if (!active || !result.ok) return;
      setStatuses(Object.fromEntries(result.data.skillpacks.map((pack) => [pack.id, {
        checkoutExists: pack.checkoutExists,
        checkoutReadable: pack.checkoutReadable,
        ...(pack.updateAvailable === undefined ? {} : {updateAvailable: pack.updateAvailable}),
        ...(pack.currentCommit === undefined ? {} : {currentCommit: pack.currentCommit}),
        discoveredSkillCount: pack.discoveredSkillCount
      }])));
    });
    return () => {
      active = false;
    };
  }, [application, localConfig.updatedAt]);

  useInput((input, key) => {
    if (isBusy(mode)) return;

    if (editSession !== undefined) {
      if (key.escape) {
        setForm(editSession.originalForm);
        setEditSession(undefined);
        return;
      }
      if (key.return) {
        setEditSession(undefined);
        return;
      }
      if (key.backspace || key.delete) {
        updateFormField(editSession.field, (value) => value.slice(0, -1));
        return;
      }
      if (key.ctrl && input === 'u') {
        updateFormField(editSession.field, () => '');
        return;
      }
      if (input.length > 0 && !key.ctrl && !key.meta) {
        updateFormField(editSession.field, (value) => `${value}${input}`);
      }
      return;
    }

    if (mode === 'list') {
      if (input === 'q' || input === 'h') return onBack();
      if (input === 'a') return startAdd();
      if (key.upArrow || input === 'k') return setListIndex((value) => Math.max(0, value - 1));
      if (key.downArrow || input === 'j') return setListIndex((value) => Math.min(orderedPacks.length, value + 1));
      if (key.return) {
        const pack = orderedPacks[listIndex];
        if (pack === undefined) startAdd();
        else openDetails(pack.id);
      }
      return;
    }

    if (mode === 'details') {
      if (input === 'q' || input === 'h' || input === 'b') return showList();
      if (input === 'e') return startEdit();
      if (input === 'u') return void previewUpdate();
      if (input === 'r' && selectedPack?.id !== defaultSkillpackId) return void previewRemoval();
      if (key.upArrow || input === 'k') return setDetailIndex((value) => Math.max(0, value - 1));
      if (key.downArrow || input === 'j') return setDetailIndex((value) => Math.min(detailActions.length - 1, value + 1));
      if (key.return) runDetailAction(detailActions[detailIndex]);
      return;
    }

    if (mode === 'add' || mode === 'edit') {
      if (input === 'q' || input === 'h' || input === 'b') return mode === 'add' ? showList() : openDetails(selectedPackId);
      if (mode === 'add' && input === 'v') return toggleAdvanced();
      const maxIndex = visibleFields.length + formActions.length - 1;
      if (key.upArrow || input === 'k') return setFormIndex((value) => Math.max(0, value - 1));
      if (key.downArrow || input === 'j') return setFormIndex((value) => Math.min(maxIndex, value + 1));
      if (key.return) {
        const field = visibleFields[formIndex];
        if (field !== undefined) {
          setEditSession({field, originalForm: form});
          return;
        }
        runFormAction(formActions[formIndex - visibleFields.length]);
      }
      return;
    }

    if (mode === 'setup-preview') {
      if (input === 'a') void applySetup();
      if (input === 'e' || input === 'b') setMode(selectedPackId === form.id && selectedPack !== undefined ? 'edit' : 'add');
      return;
    }

    if (mode === 'update-preview') {
      if (input === 'a' && updatePreview?.planId !== undefined) void applyUpdate();
      if (input === 'b' || input === 'e') openDetails(selectedPackId);
      return;
    }

    if (mode === 'remove-preview') {
      if (input === 'a') void applyRemoval();
      if (input === 'b' || input === 'e') openDetails(selectedPackId);
      return;
    }

    if (mode === 'result') {
      if (input === 'e' || input === 'b' || key.return) showList();
    }
  });

  function showList(): void {
    setMode('list');
    setErrorMessage(undefined);
    setResultMessage(undefined);
    setSetupPreview(undefined);
    setUpdatePreview(undefined);
    setRemovePlanId(undefined);
    setEditSession(undefined);
    setListIndex((value) => Math.min(value, orderedPacks.length));
  }

  function openDetails(skillpackId: string): void {
    setSelectedPackId(skillpackId);
    setDetailIndex(0);
    setMode('details');
    setErrorMessage(undefined);
    setResultMessage(undefined);
    setEditSession(undefined);
  }

  function startAdd(): void {
    setSelectedPackId('');
    setForm(createAddForm(orderedPacks.map((pack) => pack.id)));
    setAdvanced(false);
    setFormIndex(0);
    setMode('add');
    setErrorMessage(undefined);
    setEditSession(undefined);
  }

  function startEdit(): void {
    if (selectedPack === undefined) return;
    setForm({
      ...selectedPack,
      idCustomized: true,
      pathCustomized: true
    });
    setFormIndex(0);
    setMode('edit');
    setErrorMessage(undefined);
    setEditSession(undefined);
  }

  function toggleAdvanced(): void {
    setAdvanced((value) => !value);
    setFormIndex(0);
  }

  function runDetailAction(action: string | undefined): void {
    if (action === 'Edit settings') startEdit();
    else if (action === 'Check for updates') void previewUpdate();
    else if (action === 'Remove registration') void previewRemoval();
    else if (action === 'Back to repositories') showList();
  }

  function runFormAction(action: string | undefined): void {
    if (action === 'Advanced settings' || action === 'Hide advanced settings') toggleAdvanced();
    else if (action === 'Preview addition' || action === 'Preview changes') void previewSetup();
    else if (action === 'Cancel') mode === 'add' ? showList() : openDetails(selectedPackId);
  }

  function updateFormField(field: FormField, updater: (value: string) => string): void {
    setForm((current) => {
      const value = updater(current[field]);
      if (field === 'repositoryUrl') {
        if (value.trim() === '' && !current.idCustomized) {
          return {
            ...current,
            repositoryUrl: value,
            id: '',
            checkoutPath: current.pathCustomized ? current.checkoutPath : ''
          };
        }
        const suggestedId = current.idCustomized
          ? current.id
          : suggestSkillpackId(value, orderedPacks.map((pack) => pack.id), selectedPackId || undefined);
        return {
          ...current,
          repositoryUrl: value,
          id: suggestedId,
          checkoutPath: current.pathCustomized ? current.checkoutPath : defaultSkillpackCheckoutPath(suggestedId || 'additional-skillpack')
        };
      }
      if (field === 'id') {
        return {
          ...current,
          id: value,
          idCustomized: true,
          checkoutPath: current.pathCustomized ? current.checkoutPath : defaultSkillpackCheckoutPath(value || 'additional-skillpack')
        };
      }
      if (field === 'checkoutPath') return {...current, checkoutPath: value, pathCustomized: true};
      return {...current, [field]: value};
    });
  }

  async function previewSetup(): Promise<void> {
    try {
      const isAdding = mode === 'add';
      const candidate = parseSkillpackConfig({
        id: form.id.trim(),
        repositoryUrl: form.repositoryUrl.trim(),
        branch: form.branch.trim(),
        checkoutPath: form.checkoutPath.trim()
      });
      if (isAdding && orderedPacks.some((pack) => pack.id === candidate.id)) {
        setErrorMessage(`Repository ID "${candidate.id}" is already configured. Choose another ID in Advanced settings.`);
        return;
      }
      setMode('planning-setup');
      setErrorMessage(undefined);
      const result = await application.skillpackSetupPlan({
        skillpackId: candidate.id,
        repositoryUrl: candidate.repositoryUrl,
        branch: candidate.branch,
        checkoutPath: candidate.checkoutPath
      });
      if (!result.ok) {
        setErrorMessage(describeMachineErrors(result.errors));
        setMode(selectedPackId === candidate.id && selectedPack !== undefined ? 'edit' : 'add');
        return;
      }
      setSetupPreview({
        planId: result.data.planId,
        candidate,
        alreadyPresent: result.data.plan.alreadyPresent,
        ...(result.data.plan.expectedRevisionPath === undefined ? {} : {expectedRevisionPath: result.data.plan.expectedRevisionPath})
      });
      setMode('setup-preview');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setMode(selectedPackId !== '' ? 'edit' : 'add');
    }
  }

  async function applySetup(): Promise<void> {
    if (setupPreview === undefined) return;
    setMode('applying-setup');
    const result = await application.skillpackSetupApply({
      planId: setupPreview.planId,
      confirm: setupPreview.planId
    });
    if (!result.ok) {
      setErrorMessage(describeMachineErrors(result.errors));
      setMode('setup-preview');
      return;
    }
    const updatedConfig = configWithSkillpack(localConfig, setupPreview.candidate);
    setLocalConfig(updatedConfig);
    onConfigSaved(updatedConfig);
    setSelectedPackId(setupPreview.candidate.id);
    setResultMessage(result.data.message);
    setMode('result');
  }

  async function previewUpdate(): Promise<void> {
    if (selectedPack === undefined) return;
    setMode('planning-update');
    setErrorMessage(undefined);
    const result = await application.skillpackUpdatePreview({skillpackId: selectedPack.id});
    if (!result.ok) {
      setErrorMessage(describeMachineErrors(result.errors));
      setMode('details');
      return;
    }
    setUpdatePreview({
      ...(result.data.planId === undefined ? {} : {planId: result.data.planId}),
      status: result.data.status,
      message: result.data.message,
      addedSkillIds: result.data.plan?.addedSkillIds ?? [],
      changedSkillIds: result.data.plan?.changedSkillIds ?? [],
      removedSkillIds: result.data.plan?.removedSkillIds ?? [],
      skillDeltas: result.data.plan?.skillDeltas ?? [],
      bundleDeltas: result.data.plan?.bundleDeltas ?? [],
      affectedBundles: result.data.plan?.affectedBundles ?? []
    });
    setMode('update-preview');
  }

  async function applyUpdate(): Promise<void> {
    if (updatePreview?.planId === undefined) return;
    setMode('applying-update');
    const result = await application.skillpackUpdateApply({
      planId: updatePreview.planId,
      confirm: updatePreview.planId
    });
    if (!result.ok) {
      setErrorMessage(describeMachineErrors(result.errors));
      setMode('update-preview');
      return;
    }
    setResultMessage(result.data.message);
    setLocalConfig((current) => ({...current, updatedAt: new Date().toISOString()}));
    setMode('result');
  }

  async function previewRemoval(): Promise<void> {
    if (selectedPack === undefined || selectedPack.id === defaultSkillpackId) return;
    setMode('planning-remove');
    setErrorMessage(undefined);
    const result = await application.skillpackRemovePlan({skillpackId: selectedPack.id});
    if (!result.ok) {
      setErrorMessage(describeMachineErrors(result.errors));
      setMode('details');
      return;
    }
    setRemovePlanId(result.data.planId);
    setMode('remove-preview');
  }

  async function applyRemoval(): Promise<void> {
    if (removePlanId === undefined || selectedPack === undefined) return;
    setMode('applying-remove');
    const result = await application.skillpackRemoveApply({planId: removePlanId, confirm: removePlanId});
    if (!result.ok) {
      setErrorMessage(describeMachineErrors(result.errors));
      setMode('remove-preview');
      return;
    }
    const updatedConfig = configWithoutSkillpack(localConfig, result.data.skillpackId);
    setLocalConfig(updatedConfig);
    onConfigSaved(updatedConfig);
    setListIndex(0);
    setResultMessage(`Repository "${result.data.skillpackId}" was unregistered. Immutable snapshots were preserved.`);
    setMode('result');
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Manage Skillpacks</Text>
        <Text dimColor>Default and additional repositories stay side by side. The default is always protected.</Text>
        {errorMessage === undefined ? null : <Text color="red">{errorMessage}</Text>}
      </Box>

      {mode === 'list' ? (
        <RepositoryList
          defaultPack={defaultPack}
          additionalPacks={additionalPacks}
          orderedPacks={orderedPacks}
          selectedIndex={listIndex}
          statuses={statuses}
        />
      ) : null}
      {mode === 'details' && selectedPack !== undefined ? (
        <RepositoryDetails
          pack={selectedPack}
          status={statuses[selectedPack.id]}
          actions={detailActions}
          selectedAction={detailIndex}
        />
      ) : null}
      {(mode === 'add' || mode === 'edit') ? (
        <RepositoryForm
          kind={mode}
          form={form}
          advanced={advanced}
          fields={visibleFields}
          actions={formActions}
          selectedIndex={formIndex}
          editingField={editSession?.field}
        />
      ) : null}
      {mode === 'planning-setup' ? <BusyMessage message="Preparing a safe setup plan..." /> : null}
      {mode === 'setup-preview' && setupPreview !== undefined ? <SetupPreview preview={setupPreview} existing={selectedPackId === setupPreview.candidate.id && selectedPack !== undefined} /> : null}
      {mode === 'applying-setup' ? <BusyMessage message="Applying the confirmed setup plan..." /> : null}
      {mode === 'planning-update' ? <BusyMessage message="Preparing an immutable update preview..." /> : null}
      {mode === 'update-preview' && updatePreview !== undefined ? <UpdatePreview preview={updatePreview} /> : null}
      {mode === 'applying-update' ? <BusyMessage message="Activating the confirmed revision..." /> : null}
      {mode === 'planning-remove' ? <BusyMessage message="Checking whether this repository can be removed..." /> : null}
      {mode === 'remove-preview' && selectedPack !== undefined ? <RemovePreview pack={selectedPack} /> : null}
      {mode === 'applying-remove' ? <BusyMessage message="Removing the registration..." /> : null}
      {mode === 'result' ? (
        <Box flexDirection="column">
          <Text bold color="green">Done</Text>
          <Text>{resultMessage ?? 'Operation completed.'}</Text>
        </Box>
      ) : null}

      <CommandBar hints={helpHints(mode, editSession !== undefined, selectedPack?.id === defaultSkillpackId, updatePreview?.planId !== undefined)} />
    </Box>
  );
}

function RepositoryList({
  defaultPack,
  additionalPacks,
  orderedPacks,
  selectedIndex,
  statuses
}: {
  defaultPack: SkillpackConfig | undefined;
  additionalPacks: SkillpackConfig[];
  orderedPacks: SkillpackConfig[];
  selectedIndex: number;
  statuses: Record<string, PackStatus>;
}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>DEFAULT REPOSITORY</Text>
        {defaultPack === undefined ? <Text color="red">  Default repository is missing.</Text> : (
          <RepositoryRow
            pack={defaultPack}
            selected={orderedPacks[selectedIndex]?.id === defaultPack.id}
            status={statuses[defaultPack.id]}
            kind="default"
          />
        )}
      </Box>
      <Box flexDirection="column">
        <Text bold>ADDITIONAL REPOSITORIES</Text>
        {additionalPacks.length === 0 ? (
          <Text dimColor>  No additional repositories yet.</Text>
        ) : additionalPacks.map((pack) => (
          <RepositoryRow
            key={pack.id}
            pack={pack}
            selected={orderedPacks[selectedIndex]?.id === pack.id}
            status={statuses[pack.id]}
            kind="additional"
          />
        ))}
        <Text {...(selectedIndex === orderedPacks.length ? {color: 'cyan' as const} : {})}>
          {selectedIndex === orderedPacks.length ? '> ' : '  '}+ Add repository
        </Text>
      </Box>
    </Box>
  );
}

function RepositoryRow({
  pack,
  selected,
  status,
  kind
}: {
  pack: SkillpackConfig;
  selected: boolean;
  status: PackStatus | undefined;
  kind: 'default' | 'additional';
}): React.ReactElement {
  const statusText = describeStatus(status);
  return (
    <Box flexDirection="column">
      <Text {...(selected ? {color: 'cyan' as const} : kind === 'default' ? {color: 'green' as const} : {})}>
        {selected ? '> ' : '  '}{statusText.icon} {pack.id}{' '}
        <Text bold>[{kind === 'default' ? 'DEFAULT' : 'ADDITIONAL'}]</Text>
        {kind === 'default' ? <Text bold color="yellow"> [PROTECTED]</Text> : null}
      </Text>
      <Text dimColor>    {displayRepository(pack)} · {statusText.label}</Text>
    </Box>
  );
}

function RepositoryDetails({
  pack,
  status,
  actions,
  selectedAction
}: {
  pack: SkillpackConfig;
  status: PackStatus | undefined;
  actions: string[];
  selectedAction: number;
}): React.ReactElement {
  const isDefault = pack.id === defaultSkillpackId;
  const statusText = describeStatus(status);
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{pack.id} <Text color={isDefault ? 'green' : 'cyan'}>[{isDefault ? 'DEFAULT' : 'ADDITIONAL'}]</Text>{isDefault ? <Text color="yellow"> [PROTECTED]</Text> : null}</Text>
        <Text>Status: <Text color={statusText.color ?? 'white'}>{statusText.icon} {statusText.label}</Text></Text>
        <Text>Repository: {displayRepository(pack)}</Text>
        <Text>Branch: {pack.branch}</Text>
        <Text>Active path: {pack.checkoutPath}</Text>
        {status?.currentCommit === undefined ? null : <Text>Commit: {status.currentCommit}</Text>}
        {status === undefined ? null : <Text>Discovered skills: {status.discoveredSkillCount}</Text>}
      </Box>
      <Box flexDirection="column">
        {actions.map((action, index) => (
          <Text key={action} {...(index === selectedAction ? {color: 'cyan' as const} : action.startsWith('Remove') ? {color: 'yellow' as const} : {})}>
            {index === selectedAction ? '> ' : '  '}{action}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function RepositoryForm({
  kind,
  form,
  advanced,
  fields,
  actions,
  selectedIndex,
  editingField
}: {
  kind: 'add' | 'edit';
  form: SkillpackFormState;
  advanced: boolean;
  fields: FormField[];
  actions: string[];
  selectedIndex: number;
  editingField: FormField | undefined;
}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{kind === 'add' ? 'Add additional repository' : `Edit ${form.id}`}</Text>
        <Text dimColor>{kind === 'add' ? 'Start with the Git URL. ID and active path are generated automatically.' : 'The repository ID is a stable identity and cannot be changed.'}</Text>
        {kind === 'edit' ? <Text>Repository ID: {form.id} <Text dimColor>[READ ONLY]</Text></Text> : null}
      </Box>
      <Box flexDirection="column">
        {fields.map((field, index) => (
          <FormRow
            key={field}
            field={field}
            value={form[field]}
            selected={selectedIndex === index}
            editing={editingField === field}
          />
        ))}
      </Box>
      {kind === 'add' && !advanced ? (
        <Box flexDirection="column">
          <Text dimColor>Generated ID: {form.id || '(after entering a URL)'}</Text>
          <Text dimColor>Branch: {form.branch}</Text>
          <Text dimColor>Active path: {form.checkoutPath}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column">
        {actions.map((action, index) => {
          const absoluteIndex = fields.length + index;
          return (
            <Text key={action} {...(absoluteIndex === selectedIndex ? {color: 'cyan' as const} : {})}>
              {absoluteIndex === selectedIndex ? '> ' : '  '}{action}
            </Text>
          );
        })}
      </Box>
      {kind === 'add' && advanced ? <Text dimColor>Advanced settings are visible.</Text> : null}
    </Box>
  );
}

function FormRow({field, value, selected, editing}: {field: FormField; value: string; selected: boolean; editing: boolean}): React.ReactElement {
  const labels: Record<FormField, string> = {
    repositoryUrl: 'Git repository',
    id: 'Repository ID',
    branch: 'Branch',
    checkoutPath: 'Active path'
  };
  return (
    <Text {...(selected ? {color: 'cyan' as const} : {})}>
      {selected ? '> ' : '  '}{labels[field]}: {editing ? '[' : ''}{value || '(empty)'}{editing ? ']' : ''}
    </Text>
  );
}

function SetupPreview({preview, existing}: {preview: SetupPreviewState; existing: boolean}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>{existing ? 'SETTINGS CHANGE PREVIEW' : 'ADD ADDITIONAL REPOSITORY'}</Text>
      <Text>Type: <Text color={preview.candidate.id === defaultSkillpackId ? 'green' : 'cyan'}>{preview.candidate.id === defaultSkillpackId ? 'DEFAULT · PROTECTED' : 'ADDITIONAL'}</Text></Text>
      <Text>Repository ID: {preview.candidate.id}</Text>
      <Text>Git repository: {preview.candidate.repositoryUrl}</Text>
      <Text>Branch: {preview.candidate.branch}</Text>
      <Text>Active path: {preview.candidate.checkoutPath}</Text>
      <Text>{preview.alreadyPresent ? 'The active snapshot already exists and will only be inspected.' : 'A new immutable revision snapshot will be created after approval.'}</Text>
      {preview.expectedRevisionPath === undefined ? null : <Text dimColor>Revision: {preview.expectedRevisionPath}</Text>}
    </Box>
  );
}

function UpdatePreview({preview}: {preview: UpdatePreviewState}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>UPDATE PREVIEW</Text>
      <Text>{preview.message}</Text>
      <Text>Added skills: {formatList(preview.addedSkillIds)}</Text>
      <Text>Changed skills: {formatList(preview.changedSkillIds)}</Text>
      <Text>Removed skills: {formatList(preview.removedSkillIds)}</Text>
      <SemanticUpdateSummaryView
        skillDeltas={preview.skillDeltas}
        bundleDeltas={preview.bundleDeltas}
        affectedBundles={preview.affectedBundles}
      />
      {preview.planId === undefined ? <Text dimColor>No activation is required.</Text> : null}
    </Box>
  );
}

function RemovePreview({pack}: {pack: SkillpackConfig}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color="yellow">REMOVE ADDITIONAL REPOSITORY</Text>
      <Text>Repository: {pack.id} [ADDITIONAL]</Text>
      <Text>The registration will be removed from manager config.</Text>
      <Text>Immutable revisions and the current link will be preserved.</Text>
    </Box>
  );
}

function BusyMessage({message}: {message: string}): React.ReactElement {
  return <Text color="cyan">{message}</Text>;
}

export function suggestSkillpackId(repositoryUrl: string, existingIds: readonly string[], currentId?: string): string {
  const withoutQuery = repositoryUrl.trim().split(/[?#]/, 1)[0] ?? '';
  const trimmed = withoutQuery.replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  const lastSegment = trimmed.split(/[\\/:]/).filter(Boolean).at(-1) ?? '';
  const base = lastSegment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '') || 'additional-skillpack';
  const occupied = new Set(existingIds.filter((id) => id !== currentId));
  if (!occupied.has(base)) return base;
  let suffix = 2;
  while (occupied.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function createAddForm(existingIds: readonly string[]): SkillpackFormState {
  return {
    id: '',
    repositoryUrl: '',
    branch: defaultSkillpackBranch,
    checkoutPath: '',
    idCustomized: false,
    pathCustomized: false
  };
}

function displayedSkillpacks(config: ManagerConfig): SkillpackConfig[] {
  const packs = getSkillpacks(config);
  if (packs.some((pack) => pack.id === defaultSkillpackId)) return packs;
  return [protectedDefaultSkillpack(), ...packs];
}

function protectedDefaultSkillpack(): SkillpackConfig {
  return {
    id: defaultSkillpackId,
    repositoryUrl: defaultSkillpackRepositoryUrl,
    branch: defaultSkillpackBranch,
    checkoutPath: defaultSkillpackCheckoutPath(defaultSkillpackId)
  };
}

function configWithSkillpack(config: ManagerConfig, candidate: SkillpackConfig): ManagerConfig {
  const skillpacks = Object.fromEntries(displayedSkillpacks(config).map((pack) => [pack.id, pack]));
  skillpacks[candidate.id] = candidate;
  const primary = skillpacks[defaultSkillpackId] ?? protectedDefaultSkillpack();
  return {
    ...config,
    version: 3,
    skillpack: primary,
    skillpacks,
    updatedAt: new Date().toISOString()
  };
}

function configWithoutSkillpack(config: ManagerConfig, skillpackId: string): ManagerConfig {
  const skillpacks = Object.fromEntries(displayedSkillpacks(config).map((pack) => [pack.id, pack]));
  delete skillpacks[skillpackId];
  const primary = skillpacks[defaultSkillpackId] ?? protectedDefaultSkillpack();
  return {
    ...config,
    version: 3,
    skillpack: primary,
    skillpacks,
    updatedAt: new Date().toISOString()
  };
}

function displayRepository(pack: SkillpackConfig): string {
  return pack.repositoryUrl === defaultSkillpackRepositoryUrl ? defaultSkillpackDisplayName : pack.repositoryUrl;
}

function describeStatus(status: PackStatus | undefined): {icon: string; label: string; color?: 'yellow' | 'red' | 'green'} {
  if (status === undefined) return {icon: '○', label: 'Configured'};
  if (!status.checkoutExists) return {icon: '!', label: 'Setup required', color: 'yellow'};
  if (!status.checkoutReadable) return {icon: '!', label: 'Unavailable', color: 'red'};
  if (status.updateAvailable) return {icon: '!', label: 'Update available', color: 'yellow'};
  return {icon: '✓', label: 'Ready', color: 'green'};
}

function isBusy(mode: ScreenMode): boolean {
  return mode === 'planning-setup' || mode === 'applying-setup' || mode === 'planning-update' || mode === 'applying-update' || mode === 'planning-remove' || mode === 'applying-remove';
}

function formatList(values: string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

function helpHints(mode: ScreenMode, editing: boolean, isDefault: boolean, updateCanApply: boolean): CommandHint[] {
  if (editing) return [
    {key: 'type', label: 'edit'},
    {key: 'backspace', label: 'delete'},
    {key: 'ctrl+u', label: 'clear'},
    {key: 'enter', label: 'finish'},
    {key: 'esc', label: 'cancel field edit'}
  ];
  if (isBusy(mode)) return [{key: 'wait', label: 'working'}];
  if (mode === 'list') return [
    {key: 'up/down', label: 'select'},
    {key: 'enter', label: 'open'},
    {key: 'a', label: 'add repository', tone: 'apply'},
    {key: 'h/q', label: 'Home'}
  ];
  if (mode === 'details') return [
    {key: 'up/down', label: 'select'},
    {key: 'enter', label: 'open action'},
    {key: 'e', label: 'edit'},
    {key: 'u', label: 'update'},
    ...(isDefault ? [] : [{key: 'r', label: 'remove'}]),
    {key: 'b', label: 'repositories'}
  ];
  if (mode === 'add' || mode === 'edit') return [
    {key: 'up/down', label: 'select'},
    {key: 'enter', label: 'edit/open'},
    ...(mode === 'add' ? [{key: 'v', label: 'advanced'}] : []),
    {key: 'b', label: 'cancel'}
  ];
  if (mode === 'setup-preview') return [
    {key: 'a', label: 'apply reviewed plan', tone: 'apply'},
    {key: 'e/b', label: 'edit'}
  ];
  if (mode === 'update-preview') return [
    ...(updateCanApply ? [{key: 'a', label: 'activate revision', tone: 'apply' as const}] : []),
    {key: 'b/e', label: 'details'}
  ];
  if (mode === 'remove-preview') return [
    {key: 'a', label: 'unregister', tone: 'apply'},
    {key: 'b/e', label: 'cancel'}
  ];
  return [{key: 'e/enter', label: 'repositories'}];
}
