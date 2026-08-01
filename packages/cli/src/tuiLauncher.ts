/**
 * The Ink launch path, unchanged from the original entrypoint.
 *
 * This module is imported dynamically and only when `corvus-skills` is invoked with no
 * arguments, so a machine command never loads React, Ink, or the TUI at runtime.
 */
export async function launchTui(entryUrl: string): Promise<void> {
  const [{default: React}, {render}, {App, ErrorBoundary}, {readManagerPackageRuntime}, {clearTerminal}] =
    await Promise.all([
      import('react'),
      import('ink'),
      import('@corvus-tools/skill-manager-tui'),
      import('./managerPackageRuntime.js'),
      import('./terminal.js')
    ]);

  clearTerminal();
  render(
    React.createElement(
      ErrorBoundary,
      null,
      React.createElement(App, {managerPackage: readManagerPackageRuntime(entryUrl)})
    )
  );
}
