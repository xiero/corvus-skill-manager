#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import {App, ErrorBoundary} from '@corvus-tools/skill-manager-tui';
import {readManagerPackageRuntime} from './managerPackageRuntime.js';

render(
  React.createElement(
    ErrorBoundary,
    null,
    React.createElement(App, {managerPackage: readManagerPackageRuntime(import.meta.url)})
  )
);
