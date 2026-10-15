import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  adaptersForScope, getAgentAdapters, loadConfig, profileAgents,
  type AgentConfig, type InstallPlanData, type ManagerConfig, type ProfileScope
} from '@corvus-tools/skill-manager-core';
import {useCorvusApplication} from '../application/applicationContext.js';

interface CatalogItem {id: string; kind: 'skill' | 'bundle'; description: string}
export function ProjectSkillsScreen({scope, config, onBack, onConfigSaved, guided = false}: {
  scope: ProfileScope;
  config: ManagerConfig;
  onBack: () => void;
  onConfigSaved: (config: ManagerConfig) => void;
  guided?: boolean;
}): React.ReactElement {
  const application = useCorvusApplication();
  const adapters = useMemo(() => adaptersForScope(getAgentAdapters(), scope), [scope]);
  const [agentIndex, setAgentIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [mode, setMode] = useState<'agents' | 'skills' | 'target' | 'preview'>('agents');
  const [draft, setDraft] = useState<AgentConfig>({enabled: true, selectedSkillIds: [], selectedBundleIds: []});
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [plan, setPlan] = useState<InstallPlanData>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const adapter = adapters[agentIndex]!;
  useEffect(() => {
    const saved = profileAgents(config, scope)[adapter.id];
    setDraft({enabled: saved?.enabled ?? true, selectedSkillIds: [...(saved?.selectedSkillIds ?? [])], selectedBundleIds: [...(saved?.selectedBundleIds ?? [])], targetPath: saved?.targetPath ?? adapter.defaultTargetPath ?? ''});
    setPlan(undefined);
    setItemIndex(0);
  }, [adapter.id, config, scope]);
  useEffect(() => {
    let active = true;
    setItems([]);
    application.discoverSkills().then((result) => {
      if (!active) return;
      if (!result.ok) {setMessage(result.errors.map((error) => error.message).join('\n')); return;}
      const discovery = result.data.discovery;
      setItems([
        ...discovery.bundles.filter((bundle) => bundle.members.every((member) => discovery.skills.some((skill) => (skill.ref ?? skill.id) === (member.ref ?? member.id) && skill.supportedAgents.includes(adapter.id)))).map((bundle): CatalogItem => ({id: bundle.ref ?? bundle.id, kind: 'bundle', description: bundle.description})),
        ...discovery.skills.filter((skill) => skill.supportedAgents.includes(adapter.id)).map((skill): CatalogItem => ({id: skill.ref ?? skill.id, kind: 'skill', description: skill.description}))
      ]);
    }).catch((error: unknown) => {if (active) setMessage(String(error));});
    return () => {active = false;};
  }, [application, adapter.id]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try {await action();} catch (error) {setMessage(String(error));} finally {setBusy(false);}
  }
  async function preview() {
    const result = await application.installPlan({schemaVersion: 2, scope, enabled: draft.enabled, targetAgents: [adapter.id], selectedSkills: draft.selectedSkillIds.map((id) => ({id})), selectedBundles: draft.selectedBundleIds.map((id) => ({id})), replaceSelection: true, ...(draft.targetPath ? {agentTargetPaths: {[adapter.id]: draft.targetPath}} : {})});
    if (!result.ok) {setMessage(result.errors.map((error) => error.message).join('\n')); return;}
    setPlan(result.data); setWarnings(result.warnings.map((warning) => warning.message)); setMode('preview');
  }
  useInput((input, key) => {
    if (busy) return;
    if (mode === 'target') {
      if (key.escape || key.return) {setMode('skills'); return;}
      if (key.backspace || key.delete) setDraft((value) => ({...value, targetPath: (value.targetPath ?? '').slice(0, -1)}));
      else if (!key.ctrl && !key.meta) setDraft((value) => ({...value, targetPath: (value.targetPath ?? '') + input}));
      return;
    }
    if (input === 'q') {onBack(); return;}
    if (key.escape || input === 'b') {setMode('agents'); setPlan(undefined); return;}
    if (mode === 'preview') {
      if (input === 'a' && plan?.planId) void run(async () => {
        const result = await application.installApply({planId: plan.planId!, confirm: plan.planId!, confirmReplaceBrokenManagedLinks: true});
        if (result.ok || result.changed) onConfigSaved(await loadConfig(application.environment.configPath));
        setMode('agents'); setPlan(undefined);
        setMessage(result.ok ? `Apply: ${result.data.status}.` : result.errors.map((error) => error.message).join('\n'));
      });
      return;
    }
    if (mode === 'agents') {
      if (key.upArrow) setAgentIndex((value) => Math.max(0, value - 1));
      if (key.downArrow) setAgentIndex((value) => Math.min(adapters.length - 1, value + 1));
      if (key.return && adapter.supportStatus !== 'unavailable') setMode('skills');
      return;
    }
    if (key.upArrow) setItemIndex((value) => Math.max(0, value - 1));
    if (key.downArrow) setItemIndex((value) => Math.min(Math.max(0, items.length - 1), value + 1));
    if (input === 'e') setDraft((value) => ({...value, enabled: !value.enabled}));
    if (input === 't') setMode('target');
    if (input === 'p' || key.return) void run(preview);
    if (input === ' ' && items[itemIndex]) {
      const item = items[itemIndex]!;
      const field = item.kind === 'bundle' ? 'selectedBundleIds' : 'selectedSkillIds';
      setDraft((value) => ({...value, [field]: value[field].includes(item.id) ? value[field].filter((id) => id !== item.id) : [...value[field], item.id]}));
    }
  });
  const start = Math.max(0, itemIndex - 7);
  return <Box flexDirection="column" gap={1}>
    <Text bold>{guided ? 'Guided Flow' : 'Configure Agents'} — Project</Text>
    {mode === 'agents' ? <>
      <Text>Select an agent, then choose skills and review the changes.</Text>
      {adapters.map((item, index) => <Text key={item.id} color={index === agentIndex ? 'cyan' : 'white'}>{index === agentIndex ? '›' : ' '} {item.displayName} [{profileAgents(config, scope)[item.id]?.enabled ? 'enabled' : 'disabled'}]</Text>)}
      <Text dimColor>↑↓ agent · Enter configure · q home</Text>
    </> : mode === 'target' ? <>
      <Text>Target inside project: {draft.targetPath}▌</Text><Text dimColor>Enter: done</Text>
    </> : mode === 'preview' && plan ? <>
      <Text bold>Review {adapter.displayName}: {draft.enabled ? 'enabled' : 'disabled'}</Text>
      <Text>{plan.plan.summary.creates} creates · {plan.plan.summary.removals} removals · {plan.plan.summary.configChanges} config changes</Text>
      <Text>Skills: {draft.selectedSkillIds.join(', ') || '(none)'}</Text>
      <Text>Bundles: {draft.selectedBundleIds.join(', ') || '(none)'}</Text>
      {plan.plan.operations.map((operation) => <Text key={`${operation.type}:${operation.targetPath}`}>{operation.type}: {operation.targetPath}</Text>)}
      {warnings.map((warning, index) => <Text key={index} color="yellow">{warning}</Text>)}
      <Text color="yellow">a: approve and apply · b: cancel</Text>
    </> : <>
      <Text>{adapter.displayName} — {draft.enabled ? 'enabled' : 'disabled'} · {draft.targetPath || 'Target required'}</Text>
      <Text dimColor>Global selections remain active according to each agent’s discovery rules.</Text>
      {items.slice(start, start + 14).map((item, index) => <Text key={`${item.kind}:${item.id}`} color={start + index === itemIndex ? 'cyan' : 'white'}>{start + index === itemIndex ? '›' : ' '} [{(item.kind === 'bundle' ? draft.selectedBundleIds : draft.selectedSkillIds).includes(item.id) ? 'x' : ' '}] {item.kind}: {item.id}</Text>)}
      {items[itemIndex] ? <Text dimColor>{items[itemIndex]!.description}</Text> : <Text>No compatible skills found.</Text>}
      <Text dimColor>↑↓ move · Space toggle · e enable/disable · t target · p preview · b agents · q home</Text>
    </>}
    {busy ? <Text>Working…</Text> : null}
    {message ? <Text color="yellow">{message}</Text> : null}
  </Box>;
}
