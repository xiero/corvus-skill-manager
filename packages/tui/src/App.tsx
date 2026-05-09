import React, {useEffect, useMemo, useState} from 'react';
import {useApp, useInput} from 'ink';
import {
  type ConfigLoadResult,
  type ManagerConfig,
  defaultConfigPath,
  ensureDefaultConfig
} from '@corvus-tools/skill-manager-core';
import {
  type ConfigStatus,
  type HomeMenuItem,
  HomeScreen
} from './screens/HomeScreen.js';
import {ConfigureAgentsScreen} from './screens/ConfigureAgentsScreen.js';
import {DoctorScreen} from './screens/DoctorScreen.js';
import {HelpScreen} from './screens/HelpScreen.js';
import {PlaceholderScreen} from './screens/PlaceholderScreen.js';
import {SkillpackSetupScreen} from './screens/SkillpackSetupScreen.js';
import {StatusScreen} from './screens/StatusScreen.js';

type View = 'home' | 'setup' | 'settings' | 'status' | 'doctor' | 'help';

interface MenuItem extends HomeMenuItem {
  action: View | 'exit';
}

interface ConfigState {
  configPath: string;
  status: ConfigStatus;
  config?: ManagerConfig;
  errorMessage?: string;
}

export interface AppProps {
  initialConfigState?: ConfigState;
  loadConfig?: () => Promise<ConfigLoadResult>;
}

const menuItems: MenuItem[] = [
  {label: 'Setup Skillpack', hint: '', action: 'setup'},
  {label: 'Configure Agents', hint: '(plan links)', action: 'settings'},
  {label: 'Status', hint: '(read-only report)', action: 'status'},
  {label: 'Doctor', hint: '(read-only checks)', action: 'doctor'},
  {label: 'Help', hint: '(workflow guide)', action: 'help'},
  {label: 'Exit', hint: '', action: 'exit'}
];

export function App({
  initialConfigState,
  loadConfig = ensureDefaultConfig
}: AppProps): React.ReactElement {
  const {exit} = useApp();
  const [view, setView] = useState<View>('home');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [configState, setConfigState] = useState<ConfigState>(
    initialConfigState ?? {
      configPath: defaultConfigPath(),
      status: 'loading'
    }
  );

  useEffect(() => {
    if (initialConfigState !== undefined) {
      return;
    }

    let active = true;

    loadConfig()
      .then((result) => {
        if (!active) {
          return;
        }

        setConfigState({
          configPath: result.configPath,
          status: result.created ? 'created' : 'exists',
          config: result.config
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setConfigState({
          configPath: defaultConfigPath(),
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      });

    return () => {
      active = false;
    };
  }, [initialConfigState, loadConfig]);

  useInput((input, key) => {
    if (
      (view === 'setup' && configState.config !== undefined) ||
      (view === 'settings' && configState.config !== undefined) ||
      view === 'status' ||
      view === 'doctor' ||
      view === 'help'
    ) {
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    if (input === 'h') {
      setView('home');
      return;
    }

    if (view !== 'home') {
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((currentIndex) => Math.max(0, currentIndex - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((currentIndex) => Math.min(menuItems.length - 1, currentIndex + 1));
      return;
    }

    if (key.return) {
      const selectedItem = menuItems[selectedIndex];

      if (selectedItem?.action === 'exit') {
        exit();
        return;
      }

      if (selectedItem !== undefined) {
        setView(selectedItem.action);
      }
    }
  });

  const homeMenuItems = useMemo<HomeMenuItem[]>(
    () => menuItems.map(({label, hint}) => ({label, hint})),
    []
  );

  if (view === 'setup') {
    if (configState.config === undefined) {
      return (
        <PlaceholderScreen
          title="Setup Skillpack"
          body="Manager config is still loading. Press h to return Home."
        />
      );
    }

    return (
      <SkillpackSetupScreen
        config={configState.config}
        configPath={configState.configPath}
        onBack={() => {
          setView('home');
        }}
        onConfigSaved={(config) => {
          setConfigState((currentState) => ({
            ...currentState,
            config,
            status: 'exists'
          }));
        }}
      />
    );
  }

  if (view === 'settings') {
    if (configState.config === undefined) {
      return (
        <PlaceholderScreen
          title="Configure Agents"
          body="Manager config is still loading. Press h to return Home."
        />
      );
    }

    return (
      <ConfigureAgentsScreen
        config={configState.config}
        configPath={configState.configPath}
        onBack={() => {
          setView('home');
        }}
        onConfigSaved={(config) => {
          setConfigState((currentState) => ({
            ...currentState,
            config,
            status: 'exists'
          }));
        }}
      />
    );
  }

  if (view === 'status') {
    return (
      <StatusScreen
        configPath={configState.configPath}
        onBack={() => {
          setView('home');
        }}
      />
    );
  }

  if (view === 'doctor') {
    return (
      <DoctorScreen
        configPath={configState.configPath}
        onBack={() => {
          setView('home');
        }}
      />
    );
  }

  if (view === 'help') {
    return (
      <HelpScreen
        onBack={() => {
          setView('home');
        }}
      />
    );
  }

  const homeProps = {
    configPath: configState.configPath,
    configStatus: configState.status,
    menuItems: homeMenuItems,
    selectedIndex
  };

  return configState.errorMessage === undefined ? (
    <HomeScreen {...homeProps} />
  ) : (
    <HomeScreen {...homeProps} errorMessage={configState.errorMessage} />
  );
}
