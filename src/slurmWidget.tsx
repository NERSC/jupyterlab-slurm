import React from 'react';

import {
  ReactWidget,
} from '@jupyterlab/apputils';

import {
  PageConfig,
} from '@jupyterlab/coreutils';

import {
  FileBrowser,
} from '@jupyterlab/filebrowser';

import {
  UseSignal,
} from '@jupyterlab/apputils';

import {
  Signal,
} from '@lumino/signaling';

// Local
import { makeRequest } from './utils';
import SlurmManager from './components/SlurmManager';
import { uniqueId } from 'lodash';

export default class SlurmWidget extends ReactWidget {
  /**
   * The path where the JupyterLab server was launched
   */
  private serverRoot: string;
  /**
   * JupyterLab's default file browser
   */
  private filebrowser: FileBrowser;
  /**
   * The system username, retrieved from the server
   */
  private _user: string;
  /**
   * Fired when the user changes, eg., once the info has been loaded
   */
  private userChanged = new Signal<this, string>(this);

  constructor(filebrowser: FileBrowser) {
    super();
    this.id = uniqueId('slurm-');
    this.addClass('jp-SlurmWidget');
    this.title.label = 'Slurm Queue Manager';
    this.title.closable = true;
    this.filebrowser = filebrowser;
    this.serverRoot = PageConfig.getOption('serverRoot');
  }

  get user(): string {
    return this._user;
  }

  set user(user: string) {
    this._user = user;
    this.userChanged.emit(user);
  }

  private async fetchUser() {
    const user = await makeRequest({
      route: 'user',
      method: 'GET',
      afterResponse: async (response) => {
        if (response.status !== 200) {
          throw Error(response.statusText);
        }
        else {
          return response.text();
        }
      }
    });
    this.user = user;
  }

  onAfterAttach() {
    this.fetchUser();
  }
  
  render() {
    return (
      <UseSignal
        signal={this.userChanged}
        initialSender={this}
        initialArgs={''}
      >
        {(_, user) => (
          <SlurmManager
            serverRoot={this.serverRoot}
            filebrowser={this.filebrowser}
            user={user}>
          </SlurmManager>
        )}
      </UseSignal>
    );
  }
}
