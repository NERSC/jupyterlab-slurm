import React, { useMemo } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { useJupyterThemeMode, createJupyterMuiTheme } from '../utils/theme';

/**
 * Wraps its children in a MUI `ThemeProvider` that mirrors JupyterLab's
 * current light/dark theme. Without this, MUI components (buttons,
 * switches, tabs, disabled controls, secondary text) render with MUI's
 * light-only default palette regardless of JupyterLab's actual theme,
 * which is unreadable against a dark JupyterLab background.
 */
export const JupyterThemeProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const mode = useJupyterThemeMode();
  const theme = useMemo(() => createJupyterMuiTheme(mode), [mode]);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
};
