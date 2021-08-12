import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';

import { ICommandPalette, WidgetTracker } from '@jupyterlab/apputils';

import { ILauncher } from '@jupyterlab/launcher';

import { IFileBrowserFactory } from '@jupyterlab/filebrowser';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

// Local
import { requestAPI } from './handler';
import SlurmWidget from './slurmWidget';
import { ISlurmUserSettings } from './types';

import 'bootstrap/dist/css/bootstrap.min.css';

/**
 * The class names for the Slurm extension icon, for launcher and
 * tab, respectively
 */
const SLURM_ICON_CLASS_LAUNCHER = 'jp-SlurmWidget-NerscLaunchIcon';
const SLURM_ICON_CLASS_TAB = 'jp-SlurmWidget-NerscTabIcon';
const PLUGIN_ID = 'jupyterlab-slurm:plugin';

/**
 * Initialization data for the jupyterlab-slurm extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [
    ICommandPalette,
    ILayoutRestorer,
    IFileBrowserFactory,
    ISettingRegistry
  ],
  optional: [ILauncher],
  activate: async (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    restorer: ILayoutRestorer,
    factory: IFileBrowserFactory,
    settingRegistry: ISettingRegistry,
    launcher: ILauncher | null
  ) => {
    console.log('JupyterFrontEndPlugin.activate()');

    // Declare a Slurm widget variable
    let widget: SlurmWidget;

    // Add an application command
    const commandID = 'slurm:open';
    const filebrowser = factory.defaultBrowser;

    console.log('After restore:');
    console.log(widget);

    const parsedSettings: ISlurmUserSettings = {
      queueCols: [],
      userOnly: true,
      itemsPerPage: 10,
      itemsPerPageOptions: [10, 15, 20, 25, 30, 40, 50],
      autoReload: false,
      autoReloadRate: 60000
    };
    function loadSetting(setting: ISettingRegistry.ISettings): void {
      // Read the settings and convert to the correct type
      parsedSettings.queueCols = setting.get('queueCols')
        .composite as Array<string>;
      parsedSettings.userOnly = setting.get('userOnly').composite as boolean;
      parsedSettings.itemsPerPage = setting.get('itemsPerPage')
        .composite as number;
      parsedSettings.itemsPerPageOptions = setting.get('itemsPerPageOptions')
        .composite as Array<number>;
      parsedSettings.autoReload = setting.get('autoReload')
        .composite as boolean;
      parsedSettings.autoReloadRate = setting.get('autoReloadRate')
        .composite as number;

      console.log('Loaded UserSettings: ' + parsedSettings);
    }

    const settings = await settingRegistry.load(PLUGIN_ID);
    console.log(settings);
    loadSetting(settings);

    // Track and restore the widget state
    const tracker = new WidgetTracker<SlurmWidget>({ namespace: 'slurm' });
    restorer.restore(tracker, {
      command: commandID,
      // args: () => JSONExt.emptyObject,
      name: () => 'slurm'
    });

    // add command, when there is no active widget show the open label
    app.commands.addCommand(commandID, {
      label: 'Slurm Queue Manager',
      iconClass: SLURM_ICON_CLASS_LAUNCHER,
      execute: () => {
        if (!widget) {
          console.log(settingRegistry);
          // Instantiate a new widget if one does not exist
          widget = new SlurmWidget(filebrowser, parsedSettings);
          widget.title.icon = SLURM_ICON_CLASS_TAB;
        }

        if (!tracker.has(widget)) {
          // Track the state of the widget for later restoration
          tracker.add(widget);
          console.log('added widget to tracker');
        }

        if (!widget.isAttached) {
          // Attach the widget to the main work area if it's not there
          app.shell.add(widget);
        }
        widget.update();
        // Activate the widget
        app.shell.activateById(widget.id);
      }
    });

    // Add the command to the palette.
    palette.addItem({
      command: commandID,
      category: 'HPC Tools',
      args: { isPalette: true }
    });

    // Add a launcher item if the launcher is available.
    if (launcher) {
      launcher.add({
        command: commandID,
        rank: 1,
        category: 'HPC Tools'
      });
    }

    requestAPI<any>('get_example')
      .then(data => {
        console.log('get_example', data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_slurm server extension appears to have a problem starting.\n${reason}`
        );
      });

    requestAPI<any>('user')
      .then(data => {
        console.log('user', data['user']);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_slurm server extension appears to have trouble fetching user information.\n${reason}`
        );
      });
  }
};

export default extension;
