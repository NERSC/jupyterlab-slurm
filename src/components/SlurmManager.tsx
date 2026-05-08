'use client';

import React, { useState } from 'react';

import { Box, Tab, Tabs } from '@mui/material';

import { FileBrowser } from '@jupyterlab/filebrowser';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

// Local
import { requestAPI } from '../handler';
import SqueueDataTable from './SqueueDataTable';
import SlurmJobHistory from './SlurmJobHistory';
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

  requestAPI<any>('user')
    .then(data => {
      setUserName(data['user']);
    })
    .catch(reason => {
      console.error(
        `The jupyterlab_slurm server extension appears to have trouble fetching user information.\n${reason}`
      );
    });

  function handleTabChange(event: React.SyntheticEvent, value: number) {
    setActiveTab(value);
  }

  return (
    <div className={'jp-SlurmWidget-main'}>
      <div id="slurm-tabs">
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={activeTab} onChange={handleTabChange}>
            <Tab label="Slurm Queue" />
            <Tab label={"Job History"}/>
          </Tabs>
        </Box>
        {activeTab === 0 && (
          <div id={'jupyterlabSlurmWidget-tab-0'}>
            <SqueueDataTable
              itemsPerPageAuto={props.settings.itemsPerPageAuto as boolean}
              userOnly={props.settings.userOnly as boolean}
              userName={userName}
              reloadRate={props.settings.autoReloadRate as number}
              autoReload={props.settings.autoReload as boolean}
              itemsPerPage={props.settings.itemsPerPage as number}
              itemsPerPageOptions={props.settings.itemsPerPageOptions}
              jupyterlabFrontend={props.frontend}
              settingRegistry={props.settingRegistry}
            />
          </div>
        )}
        {activeTab === 1 && (
          <div id={'jupyterlabSlurmWidget-tab-1'}>
            <SlurmJobHistory
              userName={userName}
              jupyterLabFrontend={props.frontend}
            />
          </div>
        )}
      </div>
    </div>
  );
}
