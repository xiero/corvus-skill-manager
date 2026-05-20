import React, {useEffect, useMemo, useState} from 'react';
import {Box, useApp, useInput} from 'ink';
import {
  type ConfigLoadResult,
  type ManagerPackageRuntime,
  type ManagerConfig,
  type ManagerSelfUpdateInspection,
  defaultConfigPath,
  ensureDefaultConfig,
  inspectManagerSelfUpdate
} from '@corvus-tools/skill-manager-core';
import {
  type ConfigStatus,
  type HomeManagerUpdateState,
  type HomeMenuItem,
  HomeScreen
} from './screens/HomeScreen.js';
import {ConfigureAgentsScreen} from './screens/ConfigureAgentsScreen.js';
import {CorvusHeader} from './screens/CorvusHeader.js';
import {DoctorScreen} from './screens/DoctorScreen.js';
import {HelpScreen} from './screens/HelpScreen.js';
import {PlaceholderScreen} from './screens/PlaceholderScreen.js';
import {SkillpackSetupScreen} from './screens/SkillpackSetupScreen.js';
import {StatusScreen} from './screens/StatusScreen.js';
import {WizardScreen} from './screens/WizardScreen.js';

type View = 'wizard' | 'home' | 'setup' | 'settings' | 'status' | 'doctor' | 'help';

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
  managerPackage?: ManagerPackageRuntime;
  inspectSelfUpdate?: typeof inspectManagerSelfUpdate;
}

const menuItems: MenuItem[] = [
  {label: 'Guided Flow', hint: '(recommended wizard)', action: 'wizard'},
  {label: 'Setup Skillpack', hint: '(manual/advanced)', action: 'setup'},
  {label: 'Configure Agents', hint: '(manual plan/apply)', action: 'settings'},
  {label: 'Status', hint: '(read-only report)', action: 'status'},
  {label: 'Doctor', hint: '(read-only checks)', action: 'doctor'},
  {label: 'Help', hint: '(workflow guide)', action: 'help'},
  {label: 'Exit', hint: '', action: 'exit'}
];

export function App({
  initialConfigState,
  loadConfig = ensureDefaultConfig,
  managerPackage,
  inspectSelfUpdate = inspectManagerSelfUpdate
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
  const [managerUpdate, setManagerUpdate] = useState<HomeManagerUpdateState | undefined>();

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

  useEffect(() => {
    if (managerPackage === undefined || configState.config === undefined) {
      setManagerUpdate(undefined);
      return;
    }

    if (managerPackage.installKind !== 'global') {
      setManagerUpdate(undefined);
      return;
    }

    let active = true;
    setManagerUpdate({
      status: 'checking',
      packageName: managerPackage.packageName,
      currentVersion: managerPackage.currentVersion
    });

    inspectSelfUpdate({
      ...managerPackage,
      managerStateDir: configState.config.managerStateDir
    })
      .then((inspection: ManagerSelfUpdateInspection) => {
        if (active) {
          setManagerUpdate(inspection);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setManagerUpdate({
            ...managerPackage,
            status: 'check-failed',
            updateAvailable: false,
            fromCache: false,
            message: `Manager update check failed: ${error instanceof Error ? error.message : String(error)}.`
          });
        }
      });

    return () => {
      active = false;
    };
  }, [configState.config, inspectSelfUpdate, managerPackage]);

  useInput((input, key) => {
    if (
      (view === 'wizard' && configState.config !== undefined) ||
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

  if (view === 'wizard') {
    if (configState.config === undefined) {
      return withCorvusHeader(
        <PlaceholderScreen
          title="Guided Flow"
          body="Manager config is still loading. The wizard will start when config is ready."
        />
      );
    }

    return withCorvusHeader(
      <WizardScreen
        config={configState.config}
        configPath={configState.configPath}
        onBackHome={() => {
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

  if (view === 'setup') {
    if (configState.config === undefined) {
      return withCorvusHeader(
        <PlaceholderScreen
          title="Setup Skillpack"
          body="Manager config is still loading."
        />
      );
    }

    return withCorvusHeader(
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
      return withCorvusHeader(
        <PlaceholderScreen
          title="Configure Agents"
          body="Manager config is still loading."
        />
      );
    }

    return withCorvusHeader(
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
    return withCorvusHeader(
      <StatusScreen
        configPath={configState.configPath}
        onBack={() => {
          setView('home');
        }}
      />
    );
  }

  if (view === 'doctor') {
    return withCorvusHeader(
      <DoctorScreen
        configPath={configState.configPath}
        onBack={() => {
          setView('home');
        }}
      />
    );
  }

  if (view === 'help') {
    return withCorvusHeader(
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
    selectedIndex,
    ...(managerUpdate === undefined ? {} : {managerUpdate})
  };

  return withCorvusHeader(
    configState.errorMessage === undefined ? (
      <HomeScreen {...homeProps} />
    ) : (
      <HomeScreen {...homeProps} errorMessage={configState.errorMessage} />
    )
  );
}

function withCorvusHeader(screen: React.ReactElement): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <CorvusHeader />
      {screen}
    </Box>
  );
}
