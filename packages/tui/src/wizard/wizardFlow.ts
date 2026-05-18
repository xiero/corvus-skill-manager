import type {
  AgentAdapter,
  AgentId,
  ApplyLinkPlanResult,
  DiscoveredSkill,
  LinkPlan,
  ManagerConfig,
  SkillpackInspection,
  SkillpackRemoteUpdateInspection
} from '@corvus-tools/skill-manager-core';

export type WizardStepId = 'skillpack' | 'update' | 'agents' | 'skills' | 'plan' | 'confirm' | 'complete';

export type WizardStepStatus = 'pending' | 'active' | 'complete' | 'warning' | 'blocked';

export interface WizardDraftAgent {
  enabled: boolean;
  targetPath: string;
  selectedSkillIds: string[];
}

export interface WizardStepState {
  id: WizardStepId;
  label: string;
  status: WizardStepStatus;
  detail: string;
}

export interface WizardAction {
  stepId: WizardStepId;
  label: string;
  blocked: boolean;
}

export interface WizardSnapshot {
  config?: ManagerConfig;
  inspection?: SkillpackInspection;
  remoteUpdate?: SkillpackRemoteUpdateInspection;
  discoveredSkills?: DiscoveredSkill[];
  draftAgents?: Partial<Record<AgentId, WizardDraftAgent>>;
  plan?: LinkPlan;
  applyResult?: ApplyLinkPlanResult;
}

export interface WizardDerivation {
  steps: WizardStepState[];
  recommendedStepId: WizardStepId;
  action: WizardAction;
}

const stepLabels: Record<WizardStepId, string> = {
  skillpack: 'Skillpack',
  update: 'Update',
  agents: 'Agents',
  skills: 'Skills',
  plan: 'Plan',
  confirm: 'Apply',
  complete: 'Complete'
};

export const wizardStepIds: WizardStepId[] = [
  'skillpack',
  'update',
  'agents',
  'skills',
  'plan',
  'confirm',
  'complete'
];

export function deriveWizardFlow(snapshot: WizardSnapshot): WizardDerivation {
  const enabledAgents = Object.values(snapshot.draftAgents ?? {}).filter((agent) => agent?.enabled === true);
  const selectedSkillCount = enabledAgents.reduce(
    (count, agent) => count + (agent?.selectedSkillIds.length ?? 0),
    0
  );
  const skillpackState = deriveSkillpackState(snapshot);
  const updateState = deriveUpdateState(snapshot, skillpackState.status);
  const agentsState = deriveAgentsState(snapshot, skillpackState.status, enabledAgents.length);
  const skillsState = deriveSkillsState(snapshot, agentsState.status, selectedSkillCount);
  const planState = derivePlanState(snapshot, skillsState.status);
  const confirmState = deriveConfirmState(snapshot, planState.status);
  const completeState = deriveCompleteState(snapshot);
  const states: Record<WizardStepId, WizardStepState> = {
    skillpack: skillpackState,
    update: updateState,
    agents: agentsState,
    skills: skillsState,
    plan: planState,
    confirm: confirmState,
    complete: completeState
  };
  const recommendedStepId = findRecommendedStepId(states);

  return {
    steps: wizardStepIds.map((id) => states[id]),
    recommendedStepId,
    action: actionForState(states[recommendedStepId])
  };
}

export function isWizardAgentSelectable(adapter: AgentAdapter): boolean {
  return adapter.supportStatus === 'supported' || adapter.supportStatus === 'custom';
}

function deriveSkillpackState(snapshot: WizardSnapshot): WizardStepState {
  if (snapshot.applyResult !== undefined) {
    return step('skillpack', 'complete', 'Skillpack was ready before link apply.');
  }

  if (snapshot.config?.skillpack === undefined && snapshot.inspection === undefined) {
    return step('skillpack', 'active', 'Choose a skillpack source and inspect the active path.');
  }

  if (snapshot.inspection === undefined) {
    return step('skillpack', 'active', 'Inspect the configured active skillpack path.');
  }

  if (snapshot.inspection.status === 'checkout-missing') {
    return step('skillpack', 'active', 'Active snapshot is missing; initial clone requires preview and approval.');
  }

  if (snapshot.inspection.status === 'checkout-unreadable') {
    return step('skillpack', 'blocked', snapshot.inspection.message);
  }

  if (snapshot.inspection.status === 'checkout-dirty') {
    return step('skillpack', 'warning', 'Active checkout is dirty; the wizard will inspect and report only.');
  }

  return step('skillpack', 'complete', 'Active skillpack snapshot is readable.');
}

function deriveUpdateState(
  snapshot: WizardSnapshot,
  skillpackStatus: WizardStepStatus
): WizardStepState {
  if (skillpackStatus === 'pending' || skillpackStatus === 'active' || skillpackStatus === 'blocked') {
    return step('update', 'pending', 'Skillpack readiness is checked first.');
  }

  if (snapshot.remoteUpdate === undefined) {
    return step('update', 'active', 'Check the remote branch without modifying the active checkout.');
  }

  if (snapshot.remoteUpdate.status === 'remote-unavailable') {
    return step('update', 'warning', 'Remote update check is unavailable; configuration can continue.');
  }

  if (snapshot.remoteUpdate.updateAvailable) {
    return step('update', 'active', 'Remote update is available; preview and approval are required to activate it.');
  }

  return step('update', 'complete', 'No remote update is pending.');
}

function deriveAgentsState(
  snapshot: WizardSnapshot,
  skillpackStatus: WizardStepStatus,
  enabledAgentCount: number
): WizardStepState {
  if (snapshot.applyResult !== undefined) {
    return step('agents', 'complete', 'Agent selections were saved before apply.');
  }

  if (skillpackStatus === 'pending' || skillpackStatus === 'active' || skillpackStatus === 'blocked') {
    return step('agents', 'pending', 'Skillpack readiness comes first.');
  }

  if (enabledAgentCount === 0) {
    return step('agents', 'active', 'Enable at least one supported agent.');
  }

  return step('agents', 'complete', `${enabledAgentCount} agent${enabledAgentCount === 1 ? '' : 's'} enabled.`);
}

function deriveSkillsState(
  snapshot: WizardSnapshot,
  agentsStatus: WizardStepStatus,
  selectedSkillCount: number
): WizardStepState {
  if (snapshot.applyResult !== undefined) {
    return step('skills', 'complete', 'Skill selections were saved before apply.');
  }

  if (agentsStatus === 'pending' || agentsStatus === 'active' || agentsStatus === 'blocked') {
    return step('skills', 'pending', 'Select an agent before choosing skills.');
  }

  if (snapshot.discoveredSkills !== undefined && snapshot.discoveredSkills.length === 0) {
    return step('skills', 'blocked', 'No valid skills were discovered in the active skillpack.');
  }

  if (selectedSkillCount === 0) {
    return step('skills', 'active', 'Select at least one skill for an enabled agent.');
  }

  return step('skills', 'complete', `${selectedSkillCount} skill selection${selectedSkillCount === 1 ? '' : 's'} ready.`);
}

function derivePlanState(snapshot: WizardSnapshot, skillsStatus: WizardStepStatus): WizardStepState {
  if (snapshot.applyResult !== undefined) {
    return step('plan', 'complete', 'Dry-run plan was reviewed before apply.');
  }

  if (skillsStatus === 'pending' || skillsStatus === 'active' || skillsStatus === 'blocked') {
    return step('plan', 'pending', 'Agent and skill selections are needed before planning.');
  }

  if (snapshot.plan === undefined) {
    return step('plan', 'active', 'Generate a dry-run link plan.');
  }

  if (snapshot.plan.conflicts.length > 0) {
    return step('plan', 'blocked', 'The plan has unmanaged target conflicts.');
  }

  if (snapshot.plan.operations.length === 0) {
    return step('plan', 'warning', 'Nothing to apply; change agent or skill selections if links were expected.');
  }

  return step('plan', 'complete', `${snapshot.plan.operations.length} operation${snapshot.plan.operations.length === 1 ? '' : 's'} planned.`);
}

function deriveConfirmState(snapshot: WizardSnapshot, planStatus: WizardStepStatus): WizardStepState {
  if (snapshot.applyResult !== undefined) {
    return step('confirm', 'complete', 'Apply was explicitly approved.');
  }

  if (snapshot.plan?.conflicts.length !== undefined && snapshot.plan.conflicts.length > 0) {
    return step('confirm', 'blocked', 'Resolve conflicts outside the manager before applying.');
  }

  if (snapshot.plan?.operations.length === 0) {
    return step('confirm', 'pending', 'No operations need apply approval.');
  }

  if (planStatus !== 'complete') {
    return step('confirm', 'pending', 'Review a dry-run plan first.');
  }

  return step('confirm', 'active', 'Apply after reviewing the dry-run manager-owned link plan.');
}

function deriveCompleteState(snapshot: WizardSnapshot): WizardStepState {
  if (snapshot.applyResult === undefined) {
    return step('complete', 'pending', 'Apply has not run.');
  }

  return step(
    'complete',
    'complete',
    `Applied ${snapshot.applyResult.applied.length}; skipped ${snapshot.applyResult.skipped.length}.`
  );
}

function findRecommendedStepId(states: Record<WizardStepId, WizardStepState>): WizardStepId {
  if (states.complete.status === 'complete') {
    return 'complete';
  }

  for (const id of wizardStepIds) {
    const status = states[id].status;

    if (status === 'active' || status === 'blocked') {
      return id;
    }
  }

  for (const id of wizardStepIds) {
    if (states[id].status === 'warning') {
      return id;
    }
  }

  return 'complete';
}

function actionForState(state: WizardStepState): WizardAction {
  if (state.status === 'blocked') {
    return {
      stepId: state.id,
      label: state.detail,
      blocked: true
    };
  }

  return {
    stepId: state.id,
    label: state.detail,
    blocked: false
  };
}

function step(id: WizardStepId, status: WizardStepStatus, detail: string): WizardStepState {
  return {
    id,
    label: stepLabels[id],
    status,
    detail
  };
}
