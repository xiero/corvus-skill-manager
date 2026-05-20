#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import {App, ErrorBoundary} from '@corvus-tools/skill-manager-tui';
import {readManagerPackageRuntime} from './managerPackageRuntime.js';
import {clearTerminal} from './terminal.js';

clearTerminal();
render(
  React.createElement(
    ErrorBoundary,
    null,
    React.createElement(App, {managerPackage: readManagerPackageRuntime(import.meta.url)})
  )
);
