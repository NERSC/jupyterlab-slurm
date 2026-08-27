import React from 'react';
import { ReactWidget, UseSignal } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import { FileBrowser } from '@jupyterlab/filebrowser';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Signal } from '@lumino/signaling';
import { uniqueId } from 'lodash';

// Local
import { requestAPI } from './handler';
import { ISlurmUserSettings } from './types';
import SlurmManager from './components/SlurmManager';

type UserData = {
  user: string;
  exception?: string;
};

export default class SlurmWidget extends ReactWidget {
  /**
   * The path where the JupyterLab server was launched
   */
  private serverRoot: string;
  /**
   * Jupyterlab application
   */
  private frontend: JupyterFrontEnd;
  /**
   * JupyterLab's default file browser
   */
  private filebrowser: FileBrowser;

  private settings: ISlurmUserSettings;

  private settingRegistry: ISettingRegistry;
  /**
   * The system username, retrieved from the server
   */
  private _user: string;
  /**
   * Fired when the user changes, eg., once the info has been loaded
   */
  private userChanged = new Signal<this, string>(this);

  constructor(
    frontend: JupyterFrontEnd,
    filebrowser: FileBrowser,
    settings: ISlurmUserSettings,
    settingRegistry: ISettingRegistry
  ) {
    super();
    this.id = uniqueId('slurm-');
    this.addClass('jp-SlurmWidget');
    this.title.label = 'Slurm Dashboard';
    this.title.closable = true;
    this.frontend = frontend;
    this.filebrowser = filebrowser;
    this.settings = settings;
    this.settingRegistry = settingRegistry;
    this._user = '';
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
    return requestAPI<any>('user')
      .then(data => {
        if (data && data.success === false) {
          console.error(
            'fetchUser: server reported failure',
            data.errorMessage
          );
          return { user: '', exception: data.errorMessage };
        }
        return { user: data.user ?? data?.data?.user ?? '' };
      })
      .catch(reason => {
        console.error('fetchUser error', reason);
        return { user: '', exception: reason };
      });
  }

  onAfterAttach(): void {
    this.fetchUser().then(result => {
      this.user = result.user;
    });
  }

  render(): any {
    return (
      <UseSignal signal={this.userChanged}>
        {(sender?: any, args?: string | undefined) => (
          <SlurmManager
            frontend={this.frontend}
            filebrowser={this.filebrowser}
            settings={this.settings}
            settingRegistry={this.settingRegistry}
            serverRoot={this.serverRoot}
            user={this.user}
          />
        )}
      </UseSignal>
    );
  }
}
