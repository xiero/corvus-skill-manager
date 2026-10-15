import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {ProfileScope, ProjectRemovePlanData, ProjectsData} from '@corvus-tools/skill-manager-core';
import {useCorvusApplication} from '../application/applicationContext.js';

export function ProjectsScreen({onSelect, onBack, onChanged}: {
  onSelect: (scope: ProfileScope) => void;
  onBack: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const application = useCorvusApplication();
  const [projects, setProjects] = useState<ProjectsData['projects']>([]);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [removal, setRemoval] = useState<ProjectRemovePlanData>();
  async function refresh() {
    const result = await application.listProjects();
    if (result.ok) setProjects(result.data.projects);
    else setMessage(result.errors.map((error) => error.message).join('\n'));
  }
  useEffect(() => {void refresh().catch((error: unknown) => setMessage(String(error)));}, [application]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {await action();} catch (error) {setMessage(String(error));} finally {setBusy(false);}
  }
  useInput((keyInput, key) => {
    if (busy) return;
    if (editing) {
      if (key.escape) {setEditing(false); return;}
      if (key.return) {
        void run(async () => {
          const result = await application.resolveProject({rootPath: input});
          if (result.ok) onSelect(result.data.scope);
          else setMessage(result.errors.map((error) => error.message).join('\n'));
        });
      } else if (key.backspace || key.delete) setInput((value) => value.slice(0, -1));
      else if (!key.ctrl && !key.meta) setInput((value) => value + keyInput);
      return;
    }
    if (removal !== undefined) {
      if (key.escape || keyInput === 'b') {setRemoval(undefined); return;}
      if (keyInput === 'a') void run(async () => {
        const result = await application.projectRemoveApply({planId: removal.planId, confirm: removal.planId});
        setRemoval(undefined);
        if (result.ok) {onChanged(); setIndex(0); await refresh(); setMessage('Project removed.');}
        else setMessage(result.errors.map((error) => error.message).join('\n'));
      });
      return;
    }
    if (keyInput === 'q' || key.escape) {onBack(); return;}
    if (key.upArrow) setIndex((value) => Math.max(0, value - 1));
    if (key.downArrow) setIndex((value) => Math.min(projects.length, value + 1));
    if (keyInput === 'n') {setInput(''); setEditing(true);}
    if (key.return) {
      if (index === 0) {onSelect({kind: 'user'}); return;}
      const project = projects[index - 1];
      if (project) void run(async () => {
        const result = await application.resolveProject({rootPath: project.rootPath});
        if (result.ok) onSelect(result.data.scope);
        else setMessage(result.errors.map((error) => error.message).join('\n'));
      });
    }
    if (keyInput === 'd' && projects[index - 1]) void run(async () => {
      const result = await application.projectRemovePlan({rootPath: projects[index - 1]!.rootPath});
      if (result.ok) setRemoval(result.data);
      else setMessage(result.errors.map((error) => error.message).join('\n'));
    });
  });
  return <Box flexDirection="column" gap={1}>
    <Text bold>Global / Project</Text>
    {editing ? <>
      <Text>Existing project directory: {input}▌</Text>
      <Text dimColor>Enter: select · Esc: cancel. Saved only after an approved installation.</Text>
    </> : removal ? <>
      <Text color="yellow">Remove project: {removal.plan.scope.rootPath}</Text>
      <Text>Remove its local profile and {removal.plan.operations.length} owned links:</Text>
      {removal.plan.operations.map((operation) => <Text key={operation.targetPath}>− {operation.targetPath}</Text>)}
      <Text>a: approve removal · b: cancel</Text>
    </> : <>
      {['Global', ...projects.map((project) => project.rootPath)].map((label, itemIndex) =>
        <Text key={label} color={itemIndex === index ? 'cyan' : 'white'}>{itemIndex === index ? '›' : ' '} {label}</Text>)}
      <Text dimColor>↑↓ select · Enter open · n new project · d remove project · q back</Text>
    </>}
    {busy ? <Text>Working…</Text> : null}
    {message ? <Text color="yellow">{message}</Text> : null}
  </Box>;
}
