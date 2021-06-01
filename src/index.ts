import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';

import { ICommandPalette, WidgetTracker } from '@jupyterlab/apputils';

import { ILauncher } from '@jupyterlab/launcher';

import { JSONExt } from '@lumino/coreutils';

import { IFileBrowserFactory } from '@jupyterlab/filebrowser';

// Local
import { requestAPI } from './handler';
import SlurmWidget from './slurmWidget';
import * as config from './slurm-config/config.json';

import 'bootstrap/dist/css/bootstrap.min.css';

/**
 * The class names for the Slurm extension icon, for launcher and
 * tab, respectively
 */
const SLURM_ICON_CLASS_LAUNCHER = 'jp-NerscLaunchIcon';
const SLURM_ICON_CLASS_TAB = 'jp-NerscTabIcon';

/**
 * Initialization data for the jupyterlab-slurm extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-slurm:plugin',
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer, IFileBrowserFactory],
  optional: [ILauncher],
  activate: async (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    restorer: ILayoutRestorer,
    factory: IFileBrowserFactory,
    launcher: ILauncher | null
  ) => {
    // Declare a Slurm widget variable
    let widget: SlurmWidget = null;

    // Add an application command
    const commandID = 'slurm:open';
    const filebrowser = factory.defaultBrowser;

    // Track and restore the widget state
    const tracker = new WidgetTracker<SlurmWidget>({ namespace: 'slurm' });
    restorer.restore(tracker, {
      command: commandID,
      args: () => JSONExt.emptyObject,
      name: () => 'slurm'
    });

    // add command, when there is no active widget show the open label
    app.commands.addCommand(commandID, {
      label: 'Slurm Queue Manager',
      iconClass: SLURM_ICON_CLASS_LAUNCHER,
      execute: () => {
        if (widget === null) {
          // Instantiate a new widget if one does not exist
          widget = new SlurmWidget(filebrowser);
          widget.title.icon = SLURM_ICON_CLASS_TAB;
          // Reload table on regular intervals if autoReload is activated
          if (config['autoReload']) {
            setInterval(() => widget.update(), config['autoReloadRate']);
          }
        }

        if (!tracker.has(widget)) {
          // Track the state of the widget for later restoration
          tracker.add(widget);
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
          `The jupyterlab_slurm server extension appears to be missing.\n${reason}`
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

    requestAPI<any>('sbatch', new URLSearchParams('?inputType=contents'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '#!bash\necho "slurm test"\n' })
    })
      .then(data => {
        console.log('sbatch', data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_slurm server extension appears to have trouble running sbatch.\n${reason}`
        );
      });
  }
};

export default extension;
