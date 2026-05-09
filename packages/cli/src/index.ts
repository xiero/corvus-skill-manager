#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import {App, ErrorBoundary} from '@corvus/skill-manager-tui';

render(React.createElement(ErrorBoundary, null, React.createElement(App)));
