import React from 'react';
import { ReactWidget, UseSignal } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import { FileBrowser } from '@jupyterlab/filebrowser';
import { Signal } from '@lumino/signaling';
import { uniqueId } from 'lodash';

// Local
import { requestAPI } from './handler';
import { ISlurmUserSettings } from './types';
import SlurmManager from './components/SlurmManager';

type UserData = {
  user: string;
  exception: string;
};

export default class SlurmWidget extends ReactWidget {
  /**
   * The path where the JupyterLab server was launched
   */
  private serverRoot: string;
  /**
   * JupyterLab's default file browser
   */
  private filebrowser: FileBrowser;

  private _settings: ISlurmUserSettings;
  /**
   * The system username, retrieved from the server
   */
  private _user: string;
  /**
   * Fired when the user changes, eg., once the info has been loaded
   */
  private userChanged = new Signal<this, string>(this);

  constructor(filebrowser: FileBrowser, settings: ISlurmUserSettings) {
    super();
    this.id = uniqueId('slurm-');
    this.addClass('jp-SlurmWidget');
    this.title.label = 'Slurm Queue Manager';
    this.title.closable = true;
    this.filebrowser = filebrowser;
    this._settings = settings;
    this.serverRoot = PageConfig.getOption('serverRoot');
  }

  get user(): string {
    return this._user;
  }

  set user(user: string) {
    this._user = user;
    this.userChanged.emit(user);
  }

  private async fetchUser(): Promise<UserData> {
    try {
      requestAPI<any>('user')
        .then(data => {
          return { user: data.user };
        })
        .catch(reason => {
          console.error('fetchUser error', reason);
          throw Error(reason);
        });
    } catch (e) {
      console.error(e);
      const err = e.message;
      return { user: '', exception: err };
    }
  }

  onAfterAttach(): void {
    this.fetchUser();
  }

  render(): any {
    return (
      <UseSignal signal={this.userChanged}>
        {(_: any, user: string) => (
          <SlurmManager
            filebrowser={this.filebrowser}
            settings={this._settings}
            serverRoot={this.serverRoot}
            user={user}
          />
        )}
      </UseSignal>
    );
  }
}
