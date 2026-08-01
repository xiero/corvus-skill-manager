import {createContext, useContext, useMemo} from 'react';
import {type CorvusApplication, createCorvusApplication} from '@corvus-tools/skill-manager-core';

/**
 * Shares one `CorvusApplication` across screens.
 *
 * Screens call application use cases rather than orchestrating core primitives themselves, so
 * the TUI and the machine CLI cannot drift apart. Tests may provide a substitute application
 * built against a temporary home directory.
 */
export const CorvusApplicationContext = createContext<CorvusApplication | undefined>(undefined);

/**
 * Returns the provided application, or lazily builds one for the given config path so a screen
 * rendered on its own (as several tests do) still works.
 */
export function useCorvusApplication(configPath?: string): CorvusApplication {
  const provided = useContext(CorvusApplicationContext);

  return useMemo(
    () => provided ?? createCorvusApplication(configPath === undefined ? {} : {configPath}),
    [provided, configPath]
  );
}
