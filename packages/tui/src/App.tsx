import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {
  type ConfigLoadResult,
  type ProfileScope,
  loadConfig as readSavedConfig,
  type CorvusApplication,
  type ManagerPackageRuntime,
  type ManagerConfig,
  type ManagerSelfUpdateInspection,
  createCorvusApplication,
  defaultConfigPath,
  ensureDefaultConfig,
  inspectManagerSelfUpdate
} from '@corvus-tools/skill-manager-core';
import {CorvusApplicationContext} from './application/applicationContext.js';
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
import {ProjectsScreen} from './screens/ProjectsScreen.js';
import {ProjectSkillsScreen} from './screens/ProjectSkillsScreen.js';

type View = 'projects' | 'wizard' | 'home' | 'setup' | 'settings' | 'status' | 'doctor' | 'help';

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
  /** Shared workflow services. Tests may supply one bound to a temporary home directory. */
  application?: CorvusApplication;
}

const menuItems: MenuItem[] = [
  {label: 'Guided Flow', hint: '(recommended wizard)', action: 'wizard'},
  {label: 'Manage Skillpacks', hint: '(manual/advanced)', action: 'setup'},
  {label: 'Configure Agents', hint: '(manual plan/apply)', action: 'settings'},
  {label: 'Status', hint: '(read-only report)', action: 'status'},
  {label: 'Doctor', hint: '(read-only checks)', action: 'doctor'},
  {label: 'Global / Project', hint: '(select a profile)', action: 'projects'},
  {label: 'Help', hint: '(workflow guide)', action: 'help'},
  {label: 'Exit', hint: '', action: 'exit'}
];

export function App({
  initialConfigState,
  loadConfig = ensureDefaultConfig,
  managerPackage,
  inspectSelfUpdate = inspectManagerSelfUpdate,
  application: providedApplication
}: AppProps): React.ReactElement {
  const {exit} = useApp();
  const [view, setView] = useState<View>('home');
  const [scope, setScope] = useState<ProfileScope>({kind: 'user'});
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
      view === 'projects' ||
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
  const application = useMemo(
    () => providedApplication ?? createCorvusApplication({configPath: configState.configPath}),
    [providedApplication, configState.configPath]
  );
  const renderWithCorvusHeader = (screen: React.ReactElement): React.ReactElement => (
    <CorvusApplicationContext.Provider value={application}>
      {withCorvusHeader(<Box flexDirection="column" gap={1}><Text color="cyan">{scope.kind === "project" ? `Project: ${scope.rootPath}` : "Global profile"}</Text>{screen}</Box>, managerPackage?.currentVersion)}
    </CorvusApplicationContext.Provider>
  );

  if (view === 'projects') {
    return renderWithCorvusHeader(<ProjectsScreen onBack={() => setView('home')} onSelect={(nextScope) => {setScope(nextScope); setView('home');}} onChanged={() => {
      setScope({kind: 'user'});
      void readSavedConfig(configState.configPath).then((config) => setConfigState((state) => ({...state, config}))).catch(() => undefined);
    }} />);
  }
  if ((view === 'wizard' || view === 'settings') && scope.kind === 'project' && configState.config !== undefined) {
    return renderWithCorvusHeader(<ProjectSkillsScreen key={scope.rootPath} scope={scope} config={configState.config} guided={view === 'wizard'} onBack={() => setView('home')} onConfigSaved={(config) => setConfigState((state) => ({...state, config}))} />);
  }

  if (view === 'wizard') {
    if (configState.config === undefined) {
      return renderWithCorvusHeader(
        <PlaceholderScreen
          title="Guided Flow"
          body="Manager config is still loading. The wizard will start when config is ready."
        />
      );
    }

    return renderWithCorvusHeader(
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
      return renderWithCorvusHeader(
        <PlaceholderScreen
          title="Manage Skillpacks"
          body="Manager config is still loading."
        />
      );
    }

    return renderWithCorvusHeader(
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
      return renderWithCorvusHeader(
        <PlaceholderScreen
          title="Configure Agents"
          body="Manager config is still loading."
        />
      );
    }

    return renderWithCorvusHeader(
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
    return renderWithCorvusHeader(
      <StatusScreen
        scope={scope}
        configPath={configState.configPath}
        onBack={() => {
          setView('home');
        }}
      />
    );
  }

  if (view === 'doctor') {
    return renderWithCorvusHeader(
      <DoctorScreen
        scope={scope}
        configPath={configState.configPath}
        onBack={() => {
          setView('home');
        }}
      />
    );
  }

  if (view === 'help') {
    return renderWithCorvusHeader(
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

  return renderWithCorvusHeader(
    configState.errorMessage === undefined ? (
      <HomeScreen {...homeProps} />
    ) : (
      <HomeScreen {...homeProps} errorMessage={configState.errorMessage} />
    )
  );
}

function withCorvusHeader(screen: React.ReactElement, currentVersion?: string): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      {currentVersion === undefined ? <CorvusHeader /> : <CorvusHeader version={currentVersion} />}
      {screen}
    </Box>
  );
}
