import { useEffect, useState } from 'react';
import { createTheme, Theme } from '@mui/material/styles';

/**
 * JupyterLab toggles a `data-jp-theme-light` attribute on `document.body`
 * ("true" for light themes, "false" for dark themes). MUI components have no
 * awareness of this on their own — without an explicit `ThemeProvider`, MUI
 * falls back to its own light-mode default palette, which uses near-black
 * text/disabled/border colors that become invisible against JupyterLab's
 * dark backgrounds (buttons, toggles, tabs, disabled controls, etc.).
 *
 * `useJupyterThemeMode()` reads the current value on mount (fixing a related
 * bug where consumers only listened for attribute *changes* and so stayed on
 * the wrong mode after a reload while JupyterLab was already in dark mode)
 * and keeps watching for JupyterLab theme switches for the lifetime of the
 * component.
 */
export function useJupyterThemeMode(): 'light' | 'dark' {
  const readMode = (): 'light' | 'dark' =>
    document.body.getAttribute('data-jp-theme-light') === 'false'
      ? 'dark'
      : 'light';

  const [mode, setMode] = useState<'light' | 'dark'>(readMode);

  useEffect(() => {
    // Re-sync immediately in case the attribute was set between the initial
    // render and this effect running (e.g. theme restored after a reload).
    setMode(readMode());

    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-jp-theme-light']
    });
    return () => observer.disconnect();
  }, []);

  return mode;
}

/**
 * Builds a MUI theme matching the current JupyterLab color scheme so that
 * buttons, switches, tabs, and typography use readable, mode-appropriate
 * colors instead of MUI's light-only defaults.
 */
export function createJupyterMuiTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode
    }
  });
}
