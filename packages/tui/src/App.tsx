import React, {useEffect, useMemo, useState} from 'react';
import {useApp, useInput} from 'ink';
import {
  type ConfigLoadResult,
  defaultConfigPath,
  ensureDefaultConfig
} from '@corvus-skill-manager/core';
import {
  type ConfigStatus,
  type HomeMenuItem,
  HomeScreen
} from './screens/HomeScreen.js';
import {PlaceholderScreen} from './screens/PlaceholderScreen.js';

type View = 'home' | 'setup' | 'settings' | 'status' | 'doctor';

interface MenuItem extends HomeMenuItem {
  action: View | 'exit';
}

interface ConfigState {
  configPath: string;
  status: ConfigStatus;
  errorMessage?: string;
}

export interface AppProps {
  initialConfigState?: ConfigState;
  loadConfig?: () => Promise<ConfigLoadResult>;
}

const menuItems: MenuItem[] = [
  {label: 'Setup Skillpack', hint: '(deferred)', action: 'setup'},
  {label: 'Configure Agents', hint: '(settings placeholder)', action: 'settings'},
  {label: 'Status', hint: '(placeholder)', action: 'status'},
  {label: 'Doctor', hint: '(placeholder)', action: 'doctor'},
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
          status: result.created ? 'created' : 'exists'
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
    return (
      <PlaceholderScreen
        title="Setup Skillpack"
        body="Skillpack clone and registry discovery are deferred until the next slices."
      />
    );
  }

  if (view === 'settings') {
    return (
      <PlaceholderScreen
        title="Configure Agents"
        body="Agent target configuration will appear here once link planning exists."
      />
    );
  }

  if (view === 'status') {
    return (
      <PlaceholderScreen
        title="Status"
        body="Status will summarize config, skillpack, and managed links after setup slices are implemented."
      />
    );
  }

  if (view === 'doctor') {
    return (
      <PlaceholderScreen
        title="Doctor"
        body="Doctor checks will report configuration and filesystem health without modifying anything."
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
