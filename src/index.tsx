import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';

import {
  ICommandPalette,
  WidgetTracker,
} from '@jupyterlab/apputils';

import {
  ILauncher,
} from '@jupyterlab/launcher';

import {
  JSONExt,
} from '@phosphor/coreutils';

import {
  IFileBrowserFactory,
} from '@jupyterlab/filebrowser';

import {
  Widget,
} from '@phosphor/widgets';

// Local
import SlurmWidget from './slurmWidget';
import * as config from './slurm-config/config.json';

/**
 * The class names for the Slurm extension icon, for launcher and
 * tab, respectively
 */
const SLURM_ICON_CLASS_L = 'jp-NerscLaunchIcon';
const SLURM_ICON_CLASS_T = 'jp-NerscTabIcon';

/**
 * Activate the Slurm widget extension.
 */
function activate(
  app: JupyterFrontEnd,
  palette: ICommandPalette,
  restorer: ILayoutRestorer,
  filebrowserfactory: IFileBrowserFactory,
  launcher: ILauncher | null) {

  // Declare a Slurm widget variable
  let widget: SlurmWidget;

  // Add an application command
  const command: string = 'slurm:open';
  const filebrowser = filebrowserfactory.defaultBrowser;
  app.commands.addCommand(command, {
    label: args => (args['isPalette'] ? 'Open Slurm Queue Manager' : 'Slurm Queue'),
    iconClass: args => (args['isPalette'] ? '' : SLURM_ICON_CLASS_L),
    execute: () => {
      if (!widget) {
        // Instantiate a new widget if one does not exist
        widget = new SlurmWidget(filebrowser);
        widget.title.icon = SLURM_ICON_CLASS_T;
        // Reload table on regular intervals if autoReload is activated
        if (config["autoReload"]) {
          setInterval(() => widget.update(), config["autoReloadRate"]);
        }
      }
      if (!tracker.has(widget)) {
        // Track the state of the widget for later restoration
        tracker.add(widget);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.add(widget);
      } else {
        // Refresh the widget's state
        widget.update();
    }
      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({command, category: 'HPC Tools', args: { isPalette: true } })

  // Track and restore the widget state
  let tracker = new WidgetTracker<Widget>({ namespace: 'slurm'});
  restorer.restore(tracker, {
    command,
    args: () => JSONExt.emptyObject,
    name: () => 'slurm'
  });

    // Add a launcher item if the launcher is available.
  if (launcher) {
    launcher.add({
      command: 'slurm:open',
      rank: 1,
      category: 'HPC Tools'
    });
  }

} // activate

/**
 * Initialization data for the jupyterlab-slurm extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-slurm',
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer, IFileBrowserFactory],
  optional: [ILauncher],
  activate: activate
};

export default extension;
