import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {
  type AgentAdapter,
  type AgentConfig,
  type AgentId,
  type ApplyLinkPlanResult,
  type DiscoveredSkill,
  type GenerateLinkPlanInput,
  type LinkPlan,
  type ManagerConfig,
  type SkillDiscoveryIssue,
  type SkillRiskWarning,
  type SkillpackConfig,
  type SkillpackInspection,
  type SkillpackRemoteUpdateInspection,
  type SkillpackSetupResult,
  type SkillpackUpdateApplyResult,
  type SkillpackUpdatePreview,
  applyInitialSkillpackSetup,
  applyLinkPlan,
  applySkillpackUpdate,
  defaultSkillpackBranch,
  defaultSkillpackCheckoutPath,
  defaultSkillpackDisplayName,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl,
  discoverSkillsFromCheckout,
  generateLinkPlan,
  getAgentAdapters,
  inspectSkillpackCheckout,
  inspectSkillpackRemoteUpdate,
  parseSkillpackConfig,
  prepareSkillpackUpdatePreview,
  saveConfig
} from '@corvus-tools/skill-manager-core';
import {
  type WizardDraftAgent,
  type WizardStepId,
  deriveWizardFlow,
  isWizardAgentSelectable,
  wizardStepIds
} from '../wizard/wizardFlow.js';
import {CommandBar, type CommandHint} from './CommandBar.js';

type SkillpackField = 'id' | 'repositoryUrl' | 'branch' | 'checkoutPath';
type DiscoveryState = 'idle' | 'loading' | 'loaded' | 'error';

interface SkillpackFormState {
  id: string;
  repositoryUrl: string;
  branch: string;
  checkoutPath: string;
}

interface SkillpackEditSession {
  field: SkillpackField;
  originalForm: SkillpackFormState;
  originalInspection: SkillpackInspection | undefined;
  originalRemoteUpdate: SkillpackRemoteUpdateInspection | undefined;
  originalUpdatePreview: SkillpackUpdatePreview | undefined;
  originalUpdateResult: SkillpackUpdateApplyResult | undefined;
  originalSetupResult: SkillpackSetupResult | undefined;
}

interface TargetEditSession {
  agentId: AgentId;
  originalTargetPath: string;
  originalPlan: LinkPlan | undefined;
}

export interface WizardOperations {
  inspectSkillpackCheckout: typeof inspectSkillpackCheckout;
  inspectSkillpackRemoteUpdate: typeof inspectSkillpackRemoteUpdate;
  prepareSkillpackUpdatePreview: typeof prepareSkillpackUpdatePreview;
  applyInitialSkillpackSetup: typeof applyInitialSkillpackSetup;
  applySkillpackUpdate: typeof applySkillpackUpdate;
  discoverSkillsFromCheckout: typeof discoverSkillsFromCheckout;
  saveConfig: typeof saveConfig;
  generateLinkPlan: (input: GenerateLinkPlanInput) => LinkPlan;
  applyLinkPlan: typeof applyLinkPlan;
}

export interface WizardScreenProps {
  config: ManagerConfig;
  configPath: string;
  onBackHome: () => void;
  onConfigSaved: (config: ManagerConfig) => void;
  adapters?: AgentAdapter[];
  initialStep?: WizardStepId;
  operations?: Partial<WizardOperations>;
}

const defaultOperations: WizardOperations = {
  inspectSkillpackCheckout,
  inspectSkillpackRemoteUpdate,
  prepareSkillpackUpdatePreview,
  applyInitialSkillpackSetup,
  applySkillpackUpdate,
  discoverSkillsFromCheckout,
  saveConfig,
  generateLinkPlan,
  applyLinkPlan
};

const skillpackFields: Array<{key: SkillpackField; label: string}> = [
  {key: 'id', label: 'Skillpack ID'},
  {key: 'repositoryUrl', label: 'Git repository'},
  {key: 'branch', label: 'Branch'},
  {key: 'checkoutPath', label: 'Active path'}
];

export function WizardScreen({
  config,
  configPath,
  onBackHome,
  onConfigSaved,
  adapters: providedAdapters,
  initialStep = 'skillpack',
  operations: operationOverrides
}: WizardScreenProps): React.ReactElement {
  const {exit} = useApp();
  const operations = useMemo(
    () => ({...defaultOperations, ...operationOverrides}),
    [operationOverrides]
  );
  const adapters = useMemo(() => providedAdapters ?? getAgentAdapters(), [providedAdapters]);
  const [workingConfig, setWorkingConfig] = useState(config);
  const [currentStep, setCurrentStep] = useState<WizardStepId>(initialStep);
  const [form, setForm] = useState<SkillpackFormState>(() => createInitialSkillpackForm(config));
  const [selectedSkillpackIndex, setSelectedSkillpackIndex] = useState(0);
  const [skillpackEditSession, setSkillpackEditSession] = useState<SkillpackEditSession | undefined>();
  const [inspection, setInspection] = useState<SkillpackInspection | undefined>();
  const [remoteUpdate, setRemoteUpdate] = useState<SkillpackRemoteUpdateInspection | undefined>();
  const [updatePreview, setUpdatePreview] = useState<SkillpackUpdatePreview | undefined>();
  const [updateResult, setUpdateResult] = useState<SkillpackUpdateApplyResult | undefined>();
  const [setupResult, setSetupResult] = useState<SkillpackSetupResult | undefined>();
  const [draftAgents, setDraftAgents] = useState<Record<AgentId, WizardDraftAgent>>(() =>
    createDraftAgents(config, adapters)
  );
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [targetEditSession, setTargetEditSession] = useState<TargetEditSession | undefined>();
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [discoveryWarnings, setDiscoveryWarnings] = useState<SkillRiskWarning[]>([]);
  const [discoveryErrors, setDiscoveryErrors] = useState<SkillDiscoveryIssue[]>([]);
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>('idle');
  const [plan, setPlan] = useState<LinkPlan | undefined>();
  const [applyResult, setApplyResult] = useState<ApplyLinkPlanResult | undefined>();
  const [busyMessage, setBusyMessage] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const sortedSkills = useMemo(
    () => [...skills].sort((left, right) => left.id.localeCompare(right.id)),
    [skills]
  );
  const selectedAdapter = adapters[selectedAgentIndex] ?? adapters[0];
  const selectedAgentDraft = selectedAdapter === undefined ? undefined : draftAgents[selectedAdapter.id];
  const selectedSkillIds = new Set(selectedAgentDraft?.selectedSkillIds ?? []);
  const flow = deriveWizardFlow({
    config: workingConfig,
    ...(inspection === undefined ? {} : {inspection}),
    ...(remoteUpdate === undefined ? {} : {remoteUpdate}),
    discoveredSkills: sortedSkills,
    draftAgents,
    ...(plan === undefined ? {} : {plan}),
    ...(applyResult === undefined ? {} : {applyResult})
  });
  const currentPlan = plan ?? createLinkPlan();
  const busy = busyMessage !== undefined;
  const editingSkillpackField = skillpackEditSession?.field;
  const editingTarget = targetEditSession !== undefined;

  useEffect(() => {
    setWorkingConfig(config);
    setDraftAgents(createDraftAgents(config, adapters));
    setForm(createInitialSkillpackForm(config));
    setSkillpackEditSession(undefined);
    setTargetEditSession(undefined);
  }, [adapters, config]);

  useEffect(() => {
    void inspectConfiguredSkillpack();
    // Initial read-only inspection only; subsequent edits are refreshed with r.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (workingConfig.skillpack === undefined) {
      setSkills([]);
      setDiscoveryWarnings([]);
      setDiscoveryErrors([]);
      setDiscoveryState('idle');
      return;
    }

    let active = true;
    setDiscoveryState('loading');

    operations.discoverSkillsFromCheckout(workingConfig.skillpack.checkoutPath)
      .then((result) => {
        if (!active) {
          return;
        }

        setSkills(result.skills);
        setDiscoveryWarnings(result.warnings);
        setDiscoveryErrors(result.errors);
        setDiscoveryState('loaded');
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setSkills([]);
        setDiscoveryWarnings([]);
        setDiscoveryErrors([
          {
            severity: 'error',
            code: 'discovery-failed',
            message: error instanceof Error ? error.message : String(error)
          }
        ]);
        setDiscoveryState('error');
      });

    return () => {
      active = false;
    };
  }, [operations, workingConfig.skillpack]);

  useInput((input, key) => {
    if (busy) {
      return;
    }

    if (skillpackEditSession !== undefined) {
      handleSkillpackEditing(input, key);
      return;
    }

    if (targetEditSession !== undefined) {
      handleTargetEditing(input, key);
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    if (input === 'h') {
      onBackHome();
      return;
    }

    if (currentStep === 'skillpack') {
      handleSkillpackInput(input, key);
      return;
    }

    if (currentStep === 'update') {
      handleUpdateInput(input, key);
      return;
    }

    if (currentStep === 'agents') {
      handleAgentsInput(input, key);
      return;
    }

    if (currentStep === 'skills') {
      handleSkillsInput(input, key);
      return;
    }

    if (currentStep === 'plan') {
      handlePlanInput(input, key);
      return;
    }

    if (currentStep === 'confirm') {
      handleConfirmInput(input);
      return;
    }

    if (currentStep === 'complete' && input === 'b') {
      setCurrentStep('agents');
      setApplyResult(undefined);
      setPlan(undefined);
    }
  });

  function handleSkillpackEditing(input: string, key: {return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean}): void {
    if (skillpackEditSession === undefined) {
      return;
    }

    if (input === 'h' || input === 'q') {
      setForm(skillpackEditSession.originalForm);
      setInspection(skillpackEditSession.originalInspection);
      setRemoteUpdate(skillpackEditSession.originalRemoteUpdate);
      setUpdatePreview(skillpackEditSession.originalUpdatePreview);
      setUpdateResult(skillpackEditSession.originalUpdateResult);
      setSetupResult(skillpackEditSession.originalSetupResult);
      setSkillpackEditSession(undefined);
      return;
    }

    if (key.return) {
      setSkillpackEditSession(undefined);
      setInspection(undefined);
      setRemoteUpdate(undefined);
      setUpdatePreview(undefined);
      return;
    }

    if (key.backspace || key.delete) {
      updateSkillpackField(skillpackEditSession.field, (value) => value.slice(0, -1));
      return;
    }

    if (input.length > 0 && key.ctrl !== true && key.meta !== true) {
      updateSkillpackField(skillpackEditSession.field, (value) => `${value}${input}`);
    }
  }

  function handleTargetEditing(input: string, key: {return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean}): void {
    if (targetEditSession === undefined) {
      return;
    }

    if (input === 'h' || input === 'q') {
      setDraftAgents((currentDrafts) => ({
        ...currentDrafts,
        [targetEditSession.agentId]: {
          ...currentDrafts[targetEditSession.agentId],
          targetPath: targetEditSession.originalTargetPath
        }
      }));
      setPlan(targetEditSession.originalPlan);
      setTargetEditSession(undefined);
      return;
    }

    if (key.return) {
      setTargetEditSession(undefined);
      return;
    }

    if (key.backspace || key.delete) {
      updateSelectedAgent((draft) => ({...draft, targetPath: draft.targetPath.slice(0, -1)}));
      return;
    }

    if (input.length > 0 && key.ctrl !== true && key.meta !== true) {
      updateSelectedAgent((draft) => ({...draft, targetPath: `${draft.targetPath}${input}`}));
    }
  }

  function handleSkillpackInput(input: string, key: {upArrow?: boolean; downArrow?: boolean; return?: boolean}): void {
    if (key.upArrow || input === 'k') {
      setSelectedSkillpackIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedSkillpackIndex((index) => Math.min(skillpackFields.length - 1, index + 1));
      return;
    }

    if (key.return) {
      const field = skillpackFields[selectedSkillpackIndex];

      if (field !== undefined) {
        setSkillpackEditSession({
          field: field.key,
          originalForm: form,
          originalInspection: inspection,
          originalRemoteUpdate: remoteUpdate,
          originalUpdatePreview: updatePreview,
          originalUpdateResult: updateResult,
          originalSetupResult: setupResult
        });
      }

      return;
    }

    if (input === 'r') {
      void inspectConfiguredSkillpack();
      return;
    }

    if (input === 'a') {
      if (inspection === undefined) {
        setMessage('Inspect the skillpack before applying setup or config changes.');
        return;
      }

      void continueFromSkillpack();
    }
  }

  function handleUpdateInput(input: string, key: {return?: boolean}): void {
    if (input === 'b') {
      setCurrentStep('skillpack');
      setMessage('Returned to the Skillpack step.');
      return;
    }

    if (input === 'r') {
      void inspectConfiguredSkillpack();
      return;
    }

    if (input === 'p') {
      void previewUpdate();
      return;
    }

    if (input === 'a') {
      void confirmUpdate();
      return;
    }

    if (key.return) {
      setCurrentStep('agents');
      setMessage('Continuing with the active skillpack revision.');
    }
  }

  function handleAgentsInput(input: string, key: {upArrow?: boolean; downArrow?: boolean; return?: boolean}): void {
    if (input === 'b') {
      setCurrentStep('update');
      setMessage('Returned to the Update step.');
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedAgentIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedAgentIndex((index) => Math.min(adapters.length - 1, index + 1));
      return;
    }

    if (input === ' ') {
      toggleSelectedAgent();
      return;
    }

    if (input === 't') {
      if (selectedAdapter !== undefined && isWizardAgentSelectable(selectedAdapter)) {
        setTargetEditSession({
          agentId: selectedAdapter.id,
          originalTargetPath: draftAgents[selectedAdapter.id].targetPath,
          originalPlan: plan
        });
      }

      return;
    }

    if (key.return) {
      if (selectedAgentDraft?.enabled === true) {
        setSelectedSkillIndex(0);
        setCurrentStep('skills');
      } else {
        setMessage('Enable a supported agent before selecting skills.');
      }

      return;
    }

    if (input === 'p') {
      enterPlanStep();
    }
  }

  function handleSkillsInput(input: string, key: {upArrow?: boolean; downArrow?: boolean; return?: boolean}): void {
    if (input === 'b') {
      setCurrentStep('agents');
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedSkillIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedSkillIndex((index) => Math.min(sortedSkills.length - 1, index + 1));
      return;
    }

    if (input === ' ') {
      const skill = sortedSkills[selectedSkillIndex];

      if (skill !== undefined && selectedAdapter !== undefined) {
        toggleSkill(selectedAdapter.id, skill.id);
        setPlan(undefined);
      }

      return;
    }

    if (input === 'p' || key.return) {
      enterPlanStep();
    }
  }

  function handlePlanInput(input: string, key: {return?: boolean}): void {
    if (input === 'b') {
      setCurrentStep('skills');
      return;
    }

    if (input === 'r' || input === 'p') {
      enterPlanStep();
      return;
    }

    if (key.return) {
      openApplyStep();
      return;
    }

    if (input === 'a') {
      setMessage('Open the Apply step with Enter; the final write is still approved with a.');
    }
  }

  function handleConfirmInput(input: string): void {
    if (input === 'b') {
      setCurrentStep('plan');
      return;
    }

    if (input === 'a') {
      void applyConfirmedPlan();
    }
  }

  function updateSkillpackField(field: SkillpackField, updater: (value: string) => string): void {
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

  function updateSelectedAgent(updater: (draft: WizardDraftAgent) => WizardDraftAgent): void {
    if (selectedAdapter === undefined) {
      return;
    }

    setDraftAgents((currentDrafts) => ({
      ...currentDrafts,
      [selectedAdapter.id]: updater(currentDrafts[selectedAdapter.id])
    }));
    setPlan(undefined);
  }

  function toggleSelectedAgent(): void {
    if (selectedAdapter === undefined) {
      return;
    }

    if (!isWizardAgentSelectable(selectedAdapter)) {
      setMessage(`${selectedAdapter.displayName} is ${selectedAdapter.supportStatus} and cannot be selected.`);
      return;
    }

    updateSelectedAgent((draft) => ({...draft, enabled: !draft.enabled}));
    setMessage(undefined);
  }

  function toggleSkill(agentId: AgentId, skillId: string): void {
    setDraftAgents((currentDrafts) => {
      const draft = currentDrafts[agentId];
      const selectedSkillIds = draft.selectedSkillIds.includes(skillId) ?
        draft.selectedSkillIds.filter((candidate) => candidate !== skillId) :
        [...draft.selectedSkillIds, skillId].sort((left, right) => left.localeCompare(right));

      return {
        ...currentDrafts,
        [agentId]: {
          ...draft,
          selectedSkillIds
        }
      };
    });
  }

  async function inspectConfiguredSkillpack(): Promise<void> {
    let skillpackConfig: SkillpackConfig;

    try {
      skillpackConfig = parseSkillpackForm(form);
    } catch (error) {
      setMessage(`Skillpack form is invalid: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setBusyMessage('Inspecting active skillpack and remote branch...');
    setMessage(undefined);
    setSetupResult(undefined);

    try {
      const nextInspection = await operations.inspectSkillpackCheckout(skillpackConfig.checkoutPath);
      setInspection(nextInspection);
      setRemoteUpdate(await operations.inspectSkillpackRemoteUpdate(skillpackConfig));
    } catch (error) {
      setMessage(`Inspection failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyMessage(undefined);
    }
  }

  async function continueFromSkillpack(): Promise<void> {
    if (inspection === undefined) {
      await inspectConfiguredSkillpack();
      return;
    }

    if (inspection.status === 'checkout-unreadable') {
      setMessage('The active skillpack path is not readable. Use manual setup or fix the path before continuing.');
      return;
    }

    if (inspection.status === 'checkout-missing') {
      await confirmInitialSetup();
      return;
    }

    await saveSkillpackConfigOnly();
    setCurrentStep('update');
  }

  async function saveSkillpackConfigOnly(): Promise<ManagerConfig | undefined> {
    try {
      const skillpackConfig = parseSkillpackForm(form);
      const updatedConfig: ManagerConfig = {
        ...workingConfig,
        skillpack: skillpackConfig,
        updatedAt: new Date().toISOString()
      };

      setBusyMessage('Saving skillpack config...');
      await operations.saveConfig(updatedConfig, {configPath});
      setWorkingConfig(updatedConfig);
      onConfigSaved(updatedConfig);
      setMessage('Skillpack config saved after read-only inspection.');
      return updatedConfig;
    } catch (error) {
      setMessage(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    } finally {
      setBusyMessage(undefined);
    }
  }

  async function confirmInitialSetup(): Promise<void> {
    let skillpackConfig: SkillpackConfig;

    try {
      skillpackConfig = parseSkillpackForm(form);
    } catch (error) {
      setMessage(`Skillpack form is invalid: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setBusyMessage('Saving config and creating the initial immutable revision snapshot...');
    setMessage(undefined);

    try {
      const updatedConfig: ManagerConfig = {
        ...workingConfig,
        skillpack: skillpackConfig,
        updatedAt: new Date().toISOString()
      };

      await operations.saveConfig(updatedConfig, {configPath});
      setWorkingConfig(updatedConfig);
      onConfigSaved(updatedConfig);
      const result = await operations.applyInitialSkillpackSetup({
        config: skillpackConfig,
        managerStateDir: updatedConfig.managerStateDir
      });

      setSetupResult(result);
      setInspection(await operations.inspectSkillpackCheckout(skillpackConfig.checkoutPath));
      setRemoteUpdate(await operations.inspectSkillpackRemoteUpdate(skillpackConfig));
      setMessage(result.message);

      if (result.status === 'clone-complete') {
        setCurrentStep('update');
      }
    } catch (error) {
      setMessage(`Initial setup failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyMessage(undefined);
    }
  }

  async function previewUpdate(): Promise<void> {
    if (remoteUpdate?.updateAvailable !== true) {
      setMessage(remoteUpdate?.message ?? 'No update is available to preview.');
      return;
    }

    let skillpackConfig: SkillpackConfig;

    try {
      skillpackConfig = parseSkillpackForm(form);
    } catch (error) {
      setMessage(`Skillpack form is invalid: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setBusyMessage('Preparing inactive update preview snapshot...');
    setMessage(undefined);

    try {
      const preview = await operations.prepareSkillpackUpdatePreview({
        config: skillpackConfig,
        managerStateDir: workingConfig.managerStateDir
      });

      setUpdatePreview(preview);
      setMessage(preview.message);
    } catch (error) {
      setMessage(`Update preview failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyMessage(undefined);
    }
  }

  async function confirmUpdate(): Promise<void> {
    if (updatePreview?.status !== 'update-preview-ready') {
      setMessage('Preview the update before approving activation.');
      return;
    }

    let skillpackConfig: SkillpackConfig;

    try {
      skillpackConfig = parseSkillpackForm(form);
    } catch (error) {
      setMessage(`Skillpack form is invalid: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setBusyMessage('Activating approved revision snapshot...');
    setMessage(undefined);

    try {
      const updatedConfig: ManagerConfig = {
        ...workingConfig,
        skillpack: skillpackConfig,
        updatedAt: new Date().toISOString()
      };

      await operations.saveConfig(updatedConfig, {configPath});
      setWorkingConfig(updatedConfig);
      onConfigSaved(updatedConfig);
      const result = await operations.applySkillpackUpdate({
        config: skillpackConfig,
        managerStateDir: updatedConfig.managerStateDir
      });

      setUpdateResult(result);
      setInspection(await operations.inspectSkillpackCheckout(skillpackConfig.checkoutPath));
      setRemoteUpdate(await operations.inspectSkillpackRemoteUpdate(skillpackConfig));
      setMessage(result.message);

      if (result.status === 'update-applied' || result.status === 'no-update') {
        setCurrentStep('agents');
      }
    } catch (error) {
      setMessage(`Update activation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyMessage(undefined);
    }
  }

  function enterPlanStep(): void {
    const nextPlan = createLinkPlan();
    setPlan(nextPlan);
    setCurrentStep('plan');

    if (nextPlan.operations.length === 0 && nextPlan.conflicts.length === 0) {
      setMessage('No-op plan: enable an agent and select skills if you expected link changes.');
    } else {
      setMessage(undefined);
    }
  }

  function openApplyStep(): void {
    const nextPlan = plan ?? createLinkPlan();

    if (nextPlan.conflicts.length > 0) {
      setMessage('Apply is blocked until conflicts are resolved outside the manager.');
      return;
    }

    if (nextPlan.operations.length === 0) {
      setMessage('Nothing to apply. Go back to agents or skills if you expected links.');
      return;
    }

    setPlan(nextPlan);
    setCurrentStep('confirm');
    setMessage('Review the apply gate, then press a to apply manager-owned link changes.');
  }

  function createLinkPlan(): LinkPlan {
    return operations.generateLinkPlan({
      adapters,
      skills: sortedSkills.map((skill) => ({
        id: skill.id,
        absolutePath: skill.absolutePath
      })),
      selections: adapters.map((adapter) => ({
        agentId: adapter.id,
        enabled: draftAgents[adapter.id].enabled,
        targetPath: draftAgents[adapter.id].targetPath,
        selectedSkillIds: draftAgents[adapter.id].selectedSkillIds,
        previousSelectedSkillIds: workingConfig.agents?.[adapter.id]?.selectedSkillIds ?? []
      }))
    });
  }

  async function saveDraftAgentConfig(): Promise<ManagerConfig> {
    const agents = Object.fromEntries(
      adapters.map((adapter) => [
        adapter.id,
        serializeAgentConfig(draftAgents[adapter.id])
      ])
    ) as Record<AgentId, AgentConfig>;
    const updatedConfig: ManagerConfig = {
      ...workingConfig,
      agents,
      updatedAt: new Date().toISOString()
    };

    await operations.saveConfig(updatedConfig, {configPath});
    setWorkingConfig(updatedConfig);
    onConfigSaved(updatedConfig);
    return updatedConfig;
  }

  async function applyConfirmedPlan(): Promise<void> {
    const nextPlan = plan ?? createLinkPlan();

    if (workingConfig.skillpack === undefined) {
      setMessage('Apply blocked: skillpack is not configured.');
      setCurrentStep('plan');
      return;
    }

    if (nextPlan.conflicts.length > 0 || nextPlan.operations.length === 0) {
      setMessage('Apply blocked by conflicts or a no-op plan.');
      setCurrentStep('plan');
      return;
    }

    setBusyMessage('Saving selections and applying confirmed manager-owned links...');
    setMessage(undefined);

    try {
      const updatedConfig = await saveDraftAgentConfig();

      if (updatedConfig.skillpack === undefined) {
        throw new Error('Skillpack is not configured.');
      }

      const result = await operations.applyLinkPlan({
        plan: nextPlan,
        managerStateDir: updatedConfig.managerStateDir,
        skillpackCheckoutPath: updatedConfig.skillpack.checkoutPath,
        confirmReplaceBrokenManagedLinks: true
      });

      setApplyResult(result);
      setCurrentStep('complete');
      setMessage('Apply finished. Unmanaged files were not overwritten.');
    } catch (error) {
      setMessage(`Apply failed: ${error instanceof Error ? error.message : String(error)}`);
      setCurrentStep('plan');
    } finally {
      setBusyMessage(undefined);
    }
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Guided Flow</Text>
        <Text dimColor>Wizard progress is derived from current manager state each launch.</Text>
        <Text>
          Recommended: <Text color={flow.action.blocked ? 'red' : 'cyan'}>{flow.steps.find((step) => step.id === flow.recommendedStepId)?.label}</Text>
          {' - '}
          {flow.action.label}
        </Text>
        {busyMessage === undefined ? null : <Text color="cyan">{busyMessage}</Text>}
        {message === undefined ? null : <Text color={message.includes('failed') || message.includes('blocked') ? 'red' : 'cyan'}>{message}</Text>}
      </Box>

      <Box flexDirection="row" gap={2}>
        <WizardProgressRail currentStep={currentStep} recommendedStepId={flow.recommendedStepId} steps={flow.steps} />
        <Box flexDirection="column" flexGrow={1} gap={1}>
          {currentStep === 'skillpack' ? (
            <SkillpackStepView
              form={form}
              fields={skillpackFields}
              selectedIndex={selectedSkillpackIndex}
              editingField={editingSkillpackField}
              inspection={inspection}
              remoteUpdate={remoteUpdate}
              setupResult={setupResult}
            />
          ) : null}
          {currentStep === 'update' ? (
            <UpdateStepView remoteUpdate={remoteUpdate} updatePreview={updatePreview} updateResult={updateResult} />
          ) : null}
          {currentStep === 'agents' ? (
            <WizardAgentListView
              adapters={adapters}
              draftAgents={draftAgents}
              selectedAgentIndex={selectedAgentIndex}
              editingTarget={editingTarget}
              discoveryState={discoveryState}
              discoveryWarnings={discoveryWarnings}
              discoveryErrors={discoveryErrors}
            />
          ) : null}
          {currentStep === 'skills' && selectedAdapter !== undefined ? (
            <WizardSkillSelectionView
              adapter={selectedAdapter}
              skills={sortedSkills}
              selectedSkillIndex={selectedSkillIndex}
              selectedSkillIds={selectedSkillIds}
              discoveryState={discoveryState}
              discoveryErrors={discoveryErrors}
            />
          ) : null}
          {currentStep === 'plan' ? <WizardPlanView plan={currentPlan} /> : null}
          {currentStep === 'confirm' ? <ApplyStepView plan={currentPlan} /> : null}
          {currentStep === 'complete' && applyResult !== undefined ? <CompleteStepView result={applyResult} /> : null}
        </Box>
      </Box>

      <WizardCommandFooter
        currentStep={currentStep}
        editingSkillpackField={editingSkillpackField}
        editingTarget={editingTarget}
      />
    </Box>
  );
}

export function WizardProgressRail({
  currentStep,
  recommendedStepId,
  steps
}: {
  currentStep: WizardStepId;
  recommendedStepId: WizardStepId;
  steps: ReturnType<typeof deriveWizardFlow>['steps'];
}): React.ReactElement {
  return (
    <Box flexDirection="column" width={30} flexShrink={0}>
      <Text>
        <Text color="black" backgroundColor="#14f1d9"> flow </Text>
      </Text>
      <Text color="#00d7ff">│</Text>
      {wizardStepIds.map((id, index) => {
        const step = steps.find((candidate) => candidate.id === id);
        const selected = currentStep === id;
        const recommended = recommendedStepId === id;
        const markerColor = railMarkerColor(step?.status, selected);
        const labelColor = railLabelColor(step?.status, selected);
        const connector = connectorColor(step?.status, selected);
        const marker = railNode(step?.status, selected);
        const label = step?.label ?? id;
        const detail = selected ? 'active' : recommended ? 'next' : statusLabel(step?.status);

        return (
          <React.Fragment key={id}>
            <Text>
              <Text color={connector}>│ </Text>
              <Text color={markerColor}>{marker}</Text>
              {' '}
              <Text color={labelColor}>{label}</Text>
              {' '}
              <Text dimColor>{detail}</Text>
            </Text>
            {index === wizardStepIds.length - 1 ? null : (
              <Text color={connector}>│</Text>
            )}
          </React.Fragment>
        );
        })}
    </Box>
  );
}

function SkillpackStepView({
  form,
  fields,
  selectedIndex,
  editingField,
  inspection,
  remoteUpdate,
  setupResult
}: {
  form: SkillpackFormState;
  fields: Array<{key: SkillpackField; label: string}>;
  selectedIndex: number;
  editingField: SkillpackField | undefined;
  inspection: SkillpackInspection | undefined;
  remoteUpdate: SkillpackRemoteUpdateInspection | undefined;
  setupResult: SkillpackSetupResult | undefined;
}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>1. Skillpack</Text>
        <Text>Review the source, inspect the active path, then apply only the safe next action.</Text>
        {fields.map((field, index) => {
          const selected = selectedIndex === index;
          const editing = editingField === field.key;
          const value = displaySkillpackField(field.key, form[field.key], editing);
          const line = (
            <>
              {selected ? '>' : ' '} {field.label}: {editing ? '[' : ''}{value}{editing ? ']' : ''}
            </>
          );

          return selected ? <Text key={field.key} color="cyan">{line}</Text> : <Text key={field.key}>{line}</Text>;
        })}
      </Box>
      <SkillpackInspectionView inspection={inspection} remoteUpdate={remoteUpdate} setupResult={setupResult} />
      {inspection?.status === 'checkout-missing' ? (
        <InitialSetupPreviewView form={form} remoteUpdate={remoteUpdate} />
      ) : null}
    </Box>
  );
}

function SkillpackInspectionView({
  inspection,
  remoteUpdate,
  setupResult
}: {
  inspection: SkillpackInspection | undefined;
  remoteUpdate: SkillpackRemoteUpdateInspection | undefined;
  setupResult: SkillpackSetupResult | undefined;
}): React.ReactElement {
  if (inspection === undefined) {
    return <Text color="yellow">Press r to inspect before any setup action.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Read-only Inspection</Text>
      <Text>Active path: {inspection.checkoutPath}</Text>
      <Text color={inspection.status === 'checkout-unreadable' ? 'red' : inspection.status === 'checkout-missing' ? 'yellow' : 'green'}>
        {inspection.message}
      </Text>
      {inspection.commitHash === undefined ? null : <Text>Commit: {inspection.commitHash}</Text>}
      {inspection.dirtyFiles.length > 0 ? <Text color="yellow">Dirty files: {inspection.dirtyFiles.join(', ')}</Text> : null}
      {remoteUpdate === undefined ? <Text dimColor>Remote update state has not been checked.</Text> : (
        <Text color={remoteUpdate.updateAvailable ? 'yellow' : remoteUpdate.status === 'remote-unavailable' ? 'red' : 'green'}>
          {remoteUpdate.message}
        </Text>
      )}
      {setupResult === undefined ? null : <Text>{setupResult.message}</Text>}
    </Box>
  );
}

function InitialSetupPreviewView({
  form,
  remoteUpdate
}: {
  form: SkillpackFormState;
  remoteUpdate: SkillpackRemoteUpdateInspection | undefined;
}): React.ReactElement {
  const commit = remoteUpdate?.remoteCommitHash;

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">Initial Setup Preview</Text>
      <Text>Repository: {displaySkillpackField('repositoryUrl', form.repositoryUrl, false)}</Text>
      <Text>Branch: {form.branch}</Text>
      <Text>Active path: {form.checkoutPath}</Text>
      <Text>Revision snapshot: {previewRevisionPath(form.checkoutPath, commit)}</Text>
      <Text color="yellow">Press a only if this initial snapshot and current link should be created.</Text>
    </Box>
  );
}

function UpdateStepView({
  remoteUpdate,
  updatePreview,
  updateResult
}: {
  remoteUpdate: SkillpackRemoteUpdateInspection | undefined;
  updatePreview: SkillpackUpdatePreview | undefined;
  updateResult: SkillpackUpdateApplyResult | undefined;
}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>2. Update</Text>
        {remoteUpdate === undefined ? <Text color="yellow">Remote update state has not been checked.</Text> : (
          <Text color={remoteUpdate.updateAvailable ? 'yellow' : remoteUpdate.status === 'remote-unavailable' ? 'red' : 'green'}>
            {remoteUpdate.message}
          </Text>
        )}
        <Text dimColor>Remote detection is read-only. Preview first, then press a to activate a ready revision.</Text>
      </Box>
      {updatePreview === undefined ? null : <UpdatePreviewView preview={updatePreview} />}
      {updateResult === undefined ? null : <UpdateResultView result={updateResult} />}
    </Box>
  );
}

function UpdatePreviewView({preview}: {preview: SkillpackUpdatePreview}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Update Preview</Text>
      <Text color={preview.status === 'update-preview-ready' ? 'green' : 'yellow'}>{preview.message}</Text>
      <Text>Active commit: {preview.activeCommitHash ?? '(unknown)'}</Text>
      <Text>Remote commit: {preview.remoteCommitHash ?? '(unknown)'}</Text>
      {preview.candidateRevisionPath === undefined ? null : <Text>Preview snapshot: {preview.candidateRevisionPath}</Text>}
      <Text>Added skills: {formatList(preview.addedSkillIds)}</Text>
      <Text>Changed skills: {formatList(preview.changedSkillIds)}</Text>
      <Text>Removed skills: {formatList(preview.removedSkillIds)}</Text>
    </Box>
  );
}

function UpdateResultView({result}: {result: SkillpackUpdateApplyResult}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Update Result</Text>
      <Text color={result.status === 'update-applied' ? 'green' : result.status === 'update-failed' ? 'red' : 'yellow'}>
        {result.message}
      </Text>
      {result.activeRevisionPath === undefined ? null : <Text>Active revision: {result.activeRevisionPath}</Text>}
      {result.commitHash === undefined ? null : <Text>Commit: {result.commitHash}</Text>}
    </Box>
  );
}

export function WizardAgentListView({
  adapters,
  draftAgents,
  selectedAgentIndex,
  editingTarget,
  discoveryState,
  discoveryWarnings,
  discoveryErrors
}: {
  adapters: AgentAdapter[];
  draftAgents: Record<AgentId, WizardDraftAgent>;
  selectedAgentIndex: number;
  editingTarget: boolean;
  discoveryState: DiscoveryState;
  discoveryWarnings: SkillRiskWarning[];
  discoveryErrors: SkillDiscoveryIssue[];
}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>3. Agents</Text>
        {adapters.every((adapter) => !draftAgents[adapter.id].enabled) ? (
          <Text color="yellow">No agents enabled. Press Space on a supported agent.</Text>
        ) : null}
        {adapters.map((adapter, index) => {
          const draft = draftAgents[adapter.id];
          const selected = index === selectedAgentIndex;
          const enabled = draft.enabled ? '[x]' : '[ ]';
          const target = draft.targetPath.trim() === '' ? '(target path required)' : draft.targetPath;
          const selectable = isWizardAgentSelectable(adapter);
          const support = adapter.supportStatus === 'custom' ? 'custom target required' : adapter.supportStatus;
          const suffix = selectable ? '' : ' - deferred/unsupported; cannot be selected';
          const line = `${selected ? '>' : ' '} ${enabled} ${adapter.displayName} (${support}) -> ${target}${suffix}`;

          return selected ? (
            <Text key={adapter.id} color="cyan">
              {line}{editingTarget ? ' [editing]' : ''}
            </Text>
          ) : (
            <Text key={adapter.id}>{line}</Text>
          );
        })}
      </Box>
      <Text dimColor>Discovery: {discoveryState}</Text>
      <IssuePreview title="Discovery warnings" color="yellow" issues={discoveryWarnings.map((issue) => issue.message)} />
      <IssuePreview title="Discovery errors" color="red" issues={discoveryErrors.map((issue) => issue.message)} />
    </Box>
  );
}

function WizardSkillSelectionView({
  adapter,
  skills,
  selectedSkillIndex,
  selectedSkillIds,
  discoveryState,
  discoveryErrors
}: {
  adapter: AgentAdapter;
  skills: DiscoveredSkill[];
  selectedSkillIndex: number;
  selectedSkillIds: Set<string>;
  discoveryState: DiscoveryState;
  discoveryErrors: SkillDiscoveryIssue[];
}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>4. Skills for {adapter.displayName}</Text>
        {discoveryState === 'loading' ? <Text>Discovering skills from the active snapshot...</Text> : null}
        {skills.length === 0 ? <Text color="yellow">No valid skills discovered yet.</Text> : null}
        {skills.length > 0 && selectedSkillIds.size === 0 ? (
          <Text color="yellow">No skills selected for this agent.</Text>
        ) : null}
        {skills.map((skill, index) => {
          const selected = index === selectedSkillIndex;
          const enabled = selectedSkillIds.has(skill.id) ? '[x]' : '[ ]';
          const line = `${selected ? '>' : ' '} ${enabled} ${skill.id} - ${skill.title}`;

          return selected ? <Text key={skill.id} color="cyan">{line}</Text> : <Text key={skill.id}>{line}</Text>;
        })}
      </Box>
      <IssuePreview title="Discovery errors" color="red" issues={discoveryErrors.map((issue) => issue.message)} />
    </Box>
  );
}

export function WizardPlanView({plan}: {plan: LinkPlan}): React.ReactElement {
  const createCount = plan.operations.filter((operation) => operation.type === 'create-link').length;
  const removeCount = plan.operations.filter((operation) => operation.type === 'remove-link').length;

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>5. Plan</Text>
        <Text dimColor>Dry-run only. Nothing is applied from this step.</Text>
        <Text>Creates: {createCount}, removals: {removeCount}, conflicts: {plan.conflicts.length}</Text>
        {plan.operations.length === 0 ? (
          <Text color="yellow">Nothing to apply. Go back to agents or skills if links were expected.</Text>
        ) : null}
        {plan.conflicts.length > 0 ? (
          <Text color="red">Apply is blocked. Resolve unmanaged target conflicts outside the manager.</Text>
        ) : null}
        {plan.operations.length > 0 && plan.conflicts.length === 0 ? (
          <Text color="cyan">Press Enter to open the Apply step.</Text>
        ) : null}
      </Box>
      <Box flexDirection="column">
        <Text>Operations ({plan.operations.length})</Text>
        {plan.operations.length === 0 ? <Text dimColor>None.</Text> : null}
        {plan.operations.map((operation) => (
          <Text key={`${operation.type}-${operation.agentId}-${operation.skillId}`}>
            {operation.type} {operation.agentId}/{operation.skillId} {'->'} {operation.targetPath}
          </Text>
        ))}
      </Box>
      <IssuePreview title="Conflicts" color="red" issues={plan.conflicts.map((conflict) => conflict.message)} />
      <IssuePreview title="Warnings" color="yellow" issues={plan.warnings.map((warning) => warning.message)} />
    </Box>
  );
}

function ApplyStepView({plan}: {plan: LinkPlan}): React.ReactElement {
  const createCount = plan.operations.filter((operation) => operation.type === 'create-link').length;
  const removeCount = plan.operations.filter((operation) => operation.type === 'remove-link').length;

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold color="yellow">6. Apply</Text>
        <Text>Final approval saves draft agent config, then applies only manager-owned link operations.</Text>
        <Text>Creates: {createCount}, removals: {removeCount}</Text>
        <Text color="yellow">Press a to apply, or b to return to the dry-run plan.</Text>
      </Box>
      <WizardPlanView plan={plan} />
    </Box>
  );
}

export function CompleteStepView({result}: {result: ApplyLinkPlanResult}): React.ReactElement {
  const skippedColor = result.skipped.length === 0 ? 'green' : 'yellow';
  const completionNote =
    result.skipped.length === 0
      ? 'All guided setup steps are finished.'
      : 'The wizard is finished; review skipped operations before leaving.';

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
        <Text bold color="green">7. Complete</Text>
        <Text>
          <Text color="green">🎺 </Text>
          <Text bold color="green">Wizard complete</Text>
        </Text>
        <Text>{completionNote}</Text>
        <Text>
          <Text color="green">{result.applied.length}</Text>
          {' applied'}
          <Text dimColor>{' | '}</Text>
          <Text color={skippedColor}>{result.skipped.length}</Text>
          {' skipped'}
        </Text>
        <Text dimColor>Press h for Home, or b to adjust the guided flow.</Text>
      </Box>
      <Box flexDirection="column">
        <Text>Manifest: {result.manifestPath}</Text>
        <Text>Unmanaged files, directories, and symlinks were not overwritten.</Text>
      </Box>
      <IssuePreview title="Applied" color="green" issues={result.applied.map((item) => item.message)} />
      <IssuePreview title="Skipped" color="red" issues={result.skipped.map((item) => item.message)} />
    </Box>
  );
}

function IssuePreview({
  title,
  color,
  issues
}: {
  title: string;
  color: 'green' | 'red' | 'yellow';
  issues: string[];
}): React.ReactElement {
  if (issues.length === 0) {
    return <Text dimColor>{title}: none</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color={color}>{title} ({issues.length})</Text>
      {issues.slice(0, 4).map((issue, index) => (
        <Text key={`${title}-${index}`} color={color}>{issue}</Text>
      ))}
      {issues.length > 4 ? <Text color={color}>...and {issues.length - 4} more</Text> : null}
    </Box>
  );
}

function createInitialSkillpackForm(config: ManagerConfig): SkillpackFormState {
  const id = config.skillpack?.id ?? defaultSkillpackId;

  return {
    id,
    repositoryUrl: config.skillpack?.repositoryUrl ?? defaultSkillpackRepositoryUrl,
    branch: config.skillpack?.branch ?? defaultSkillpackBranch,
    checkoutPath: config.skillpack?.checkoutPath ?? defaultSkillpackCheckoutPath(id)
  };
}

function createDraftAgents(config: ManagerConfig, adapters: AgentAdapter[]): Record<AgentId, WizardDraftAgent> {
  return Object.fromEntries(
    adapters.map((adapter) => {
      const configuredAgent = config.agents?.[adapter.id];
      const targetPath = configuredAgent?.targetPath ?? adapter.defaultTargetPath ?? '';

      return [
        adapter.id,
        {
          enabled: isWizardAgentSelectable(adapter) ? configuredAgent?.enabled ?? false : false,
          targetPath,
          selectedSkillIds: configuredAgent?.selectedSkillIds ?? []
        }
      ];
    })
  ) as Record<AgentId, WizardDraftAgent>;
}

function serializeAgentConfig(draft: WizardDraftAgent): AgentConfig {
  const targetPath = draft.targetPath.trim();
  const config: AgentConfig = {
    enabled: draft.enabled,
    selectedSkillIds: draft.selectedSkillIds
  };

  if (targetPath !== '') {
    config.targetPath = targetPath;
  }

  return config;
}

function parseSkillpackForm(form: SkillpackFormState): SkillpackConfig {
  return parseSkillpackConfig({
    id: form.id.trim(),
    repositoryUrl: form.repositoryUrl.trim(),
    branch: form.branch.trim(),
    checkoutPath: form.checkoutPath.trim()
  });
}

function displaySkillpackField(field: SkillpackField, value: string, editing: boolean): string {
  if (field === 'repositoryUrl' && value === defaultSkillpackRepositoryUrl && !editing) {
    return defaultSkillpackDisplayName;
  }

  return value === '' ? '(empty)' : value;
}

function railNode(
  status: ReturnType<typeof deriveWizardFlow>['steps'][number]['status'] | undefined,
  selected: boolean
): string {
  if (selected) {
    return '◆';
  }

  if (status === 'complete') {
    return '◇';
  }

  if (status === 'warning') {
    return '◇';
  }

  if (status === 'blocked') {
    return '◆';
  }

  return '◇';
}

function statusLabel(status: ReturnType<typeof deriveWizardFlow>['steps'][number]['status'] | undefined): string {
  if (status === 'complete') {
    return 'done';
  }

  if (status === 'warning') {
    return 'warning';
  }

  if (status === 'blocked') {
    return 'blocked';
  }

  if (status === 'active') {
    return 'ready';
  }

  return 'pending';
}

function connectorColor(
  status: ReturnType<typeof deriveWizardFlow>['steps'][number]['status'] | undefined,
  selected: boolean
): string {
  if (selected) {
    return '#00d7ff';
  }

  if (status === 'warning') {
    return 'yellow';
  }

  if (status === 'blocked') {
    return 'red';
  }

  if (status === 'complete') {
    return '#14f1d9';
  }

  return '#2f7dff';
}

function railMarkerColor(
  status: ReturnType<typeof deriveWizardFlow>['steps'][number]['status'] | undefined,
  selected: boolean
): string {
  if (selected) {
    return '#00f5ff';
  }

  if (status === 'complete') {
    return '#14f1d9';
  }

  if (status === 'warning') {
    return 'yellow';
  }

  if (status === 'blocked') {
    return 'red';
  }

  return '#2f7dff';
}

function railLabelColor(
  status: ReturnType<typeof deriveWizardFlow>['steps'][number]['status'] | undefined,
  selected: boolean
): string {
  if (selected) {
    return '#00d7ff';
  }

  if (status === 'blocked') {
    return 'red';
  }

  if (status === 'warning') {
    return 'yellow';
  }

  return '#14f1d9';
}

function formatList(values: string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

function previewRevisionPath(checkoutPath: string, commitHash: string | undefined): string {
  const commit = commitHash ?? '<resolved-commit>';

  if (checkoutPath.endsWith('/current')) {
    return `${checkoutPath.slice(0, -'/current'.length)}/revisions/${commit}/repo`;
  }

  return `revisions/${commit}/repo under the configured skillpack root`;
}

export function WizardCommandFooter({
  currentStep,
  editingSkillpackField,
  editingTarget
}: {
  currentStep: WizardStepId;
  editingSkillpackField: SkillpackField | undefined;
  editingTarget: boolean;
}): React.ReactElement {
  const hints = commandHints(currentStep, editingSkillpackField, editingTarget);

  return <CommandBar hints={hints} />;
}

function commandHints(
  step: WizardStepId,
  editingSkillpackField: SkillpackField | undefined,
  editingTarget: boolean
): CommandHint[] {
  if (editingSkillpackField !== undefined) {
    return [
      {key: 'type', label: 'edit'},
      {key: 'backspace', label: 'delete'},
      {key: 'enter', label: 'finish'},
      {key: 'h/q', label: 'cancel'},
      {key: 'r', label: 'inspect after edit'}
    ];
  }

  if (editingTarget) {
    return [
      {key: 'type', label: 'target'},
      {key: 'backspace', label: 'delete'},
      {key: 'enter', label: 'finish'},
      {key: 'h/q', label: 'cancel'}
    ];
  }

  if (step === 'skillpack') {
    return [
      {key: 'up/down', label: 'move'},
      {key: 'enter', label: 'edit'},
      {key: 'r', label: 'inspect'},
      {key: 'a', label: 'apply setup/config', tone: 'apply'},
      {key: 'h', label: 'Home'},
      {key: 'q', label: 'exit'}
    ];
  }

  if (step === 'update') {
    return [
      {key: 'p', label: 'preview update'},
      {key: 'a', label: 'apply ready preview', tone: 'apply'},
      {key: 'enter', label: 'continue'},
      {key: 'b', label: 'skillpack'},
      {key: 'r', label: 'refresh'},
      {key: 'h', label: 'Home'},
      {key: 'q', label: 'exit'}
    ];
  }

  if (step === 'agents') {
    return [
      {key: 'up/down', label: 'move'},
      {key: 'space', label: 'toggle'},
      {key: 'enter', label: 'skills'},
      {key: 't', label: 'target'},
      {key: 'p', label: 'plan'},
      {key: 'b', label: 'update'},
      {key: 'h', label: 'Home'},
      {key: 'q', label: 'exit'}
    ];
  }

  if (step === 'skills') {
    return [
      {key: 'up/down', label: 'move'},
      {key: 'space', label: 'toggle skill'},
      {key: 'b', label: 'agents'},
      {key: 'p', label: 'plan'},
      {key: 'enter', label: 'plan'},
      {key: 'h', label: 'Home'},
      {key: 'q', label: 'exit'}
    ];
  }

  if (step === 'plan') {
    return [
      {key: 'enter', label: 'Apply'},
      {key: 'b', label: 'skills'},
      {key: 'r', label: 'regenerate plan'},
      {key: 'h', label: 'Home'},
      {key: 'q', label: 'exit'}
    ];
  }

  if (step === 'confirm') {
    return [
      {key: 'a', label: 'apply', tone: 'apply'},
      {key: 'b', label: 'plan'},
      {key: 'h', label: 'Home'},
      {key: 'q', label: 'exit'}
    ];
  }

  return [
    {key: 'b', label: 'configure again'},
    {key: 'h', label: 'Home'},
    {key: 'q', label: 'exit'}
  ];
}
