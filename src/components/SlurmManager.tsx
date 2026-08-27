'use client';

import React, { useEffect, useState } from 'react';

import { Box, Tab, Tabs } from '@mui/material';

import { FileBrowser } from '@jupyterlab/filebrowser';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
// Import from the package root so this reuses the same shared
// `Notification.manager` singleton the running JupyterLab shell's toast UI
// observes (a deep `lib/...` import bundles a disconnected private copy).
import { Notification } from '@jupyterlab/apputils';

// Local
import { requestAPI } from '../handler';
import SqueueDataTable from './SqueueDataTable';
import SlurmJobHistory from './SlurmJobHistory';
import { JupyterThemeProvider } from './JupyterThemeProvider';
import { ISlurmUserSettings } from '../types';

namespace types {
  export type Props = {
    frontend: JupyterFrontEnd;
    filebrowser: FileBrowser;
    settings: ISlurmUserSettings;
    settingRegistry: ISettingRegistry;
    serverRoot: string;
    user: string;
  };
}

export default function SlurmManager(props: types.Props) {
  const [activeTab, setActiveTab] = useState(0);
  //const [jobSubmitDisabled, setJobSubmitDisabled] = useState(false);
  const [userName, setUserName] = useState('');
  const [userFetchError, setUserFetchError] = useState<string | null>(null);

  // Surface a fetch-failure warning via JupyterLab's native toast
  // notifications (rather than an MUI Snackbar) so it matches the rest of
  // JupyterLab's UI, instead of console-only logging.
  useEffect(() => {
    if (userFetchError) {
      Notification.warning(userFetchError, { autoClose: 6000 });
      setUserFetchError(null);
    }
  }, [userFetchError]);

  // Fetch the current username once on mount. This previously ran on every
  // render (no dependency array), firing an unbounded number of /user
  // requests; it also only logged failures to the console, leaving the user
  // with no visible indication that "my jobs only" filtering, etc. may be
  // relying on an empty username.
  useEffect(() => {
    let cancelled = false;
    requestAPI<any>('user')
      .then(data => {
        if (cancelled) {
          return;
        }
        if (data && data.success === false) {
          setUserFetchError(data.errorMessage || 'Failed to fetch username.');
          return;
        }
        setUserName(data['user'] ?? data?.data?.user ?? '');
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_slurm server extension appears to have trouble fetching user information.\n${reason}`
        );
        if (!cancelled) {
          setUserFetchError(
            'Could not determine the current user; some filtering may be unavailable.'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleTabChange(event: React.SyntheticEvent, value: number) {
    setActiveTab(value);
  }

  return (
    <JupyterThemeProvider>
      <div className={'jp-SlurmWidget-main'}>
        <div id="slurm-tabs">
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={activeTab} onChange={handleTabChange}>
              <Tab label="Jobs" />
              <Tab label={'Job History'} />
            </Tabs>
          </Box>
          {/*
          Both tabs are kept mounted and toggled with CSS (display) rather than
          conditionally rendered. This preserves each tab's state across
          switches — so returning to the queue no longer triggers a cold reload
          (which also bypassed the squeue rate limit). Background work is gated
          via the `active` prop: the queue pauses polling when hidden and the
          history refetches when it becomes active.
        */}
          <div
            id={'jupyterlabSlurmWidget-tab-0'}
            style={{ display: activeTab === 0 ? 'flex' : 'none' }}
          >
            <SqueueDataTable
              itemsPerPageAuto={props.settings.itemsPerPageAuto as boolean}
              userOnly={props.settings.userOnly as boolean}
              userName={userName}
              reloadRate={props.settings.autoReloadRate as number}
              autoReload={props.settings.autoReload as boolean}
              itemsPerPage={props.settings.itemsPerPage as number}
              autoReloadRate={props.settings.autoReloadRate as number}
              itemsPerPageOptions={props.settings.itemsPerPageOptions}
              columnState={props.settings.columnState}
              notifyOnStateChange={props.settings.notifyOnStateChange as boolean}
              jupyterlabFrontend={props.frontend}
              settingRegistry={props.settingRegistry}
              active={activeTab === 0}
            />
          </div>
          <div
            id={'jupyterlabSlurmWidget-tab-1'}
            style={{ display: activeTab === 1 ? 'flex' : 'none' }}
          >
            <SlurmJobHistory
              userName={userName}
              jupyterLabFrontend={props.frontend}
              active={activeTab === 1}
            />
          </div>
        </div>
      </div>
    </JupyterThemeProvider>
  );
}
