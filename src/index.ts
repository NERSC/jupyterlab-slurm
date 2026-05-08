import type { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ILayoutRestorer } from '@jupyterlab/application';

import { ICommandPalette, WidgetTracker } from '@jupyterlab/apputils';

import { ILauncher } from '@jupyterlab/launcher';

import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import type { FileBrowser } from '@jupyterlab/filebrowser';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

// Local
import { requestAPI } from './handler';
import SlurmWidget from './slurmWidget';
import { ISlurmUserSettings } from './types';

/**
 * The class names for the Slurm extension icon, for launcher and
 * tab, respectively
 */
const SLURM_ICON_CLASS_LAUNCHER = 'jp-SlurmWidget-NerscLaunchIcon';
const SLURM_ICON_CLASS_TAB = 'jp-SlurmWidget-NerscTabIcon';
export const PLUGIN_ID = 'jupyterlab-slurm:plugin';
export const COMMAND_ID_OPEN = 'jupyterlab-slurm:open';
export const COMMAND_ID_TOGGLE_USERONLY = 'jupyterlab-slurm:toggleUserOnly';
export const COMMAND_ID_TOGGLE_AUTORELOAD = 'jupyterlab-slurm:toggleAutoReload';
export const COMMAND_ID_SHOW_DETAILS = 'jupyterlab-slurm:show-job-details';

/**
 * Initialization data for the jupyterlab-slurm extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [
    ICommandPalette,
    ILayoutRestorer,
    IDefaultFileBrowser,
    ISettingRegistry
  ],
  optional: [ILauncher],
  activate: async (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    restorer: ILayoutRestorer,
    filebrowser: IDefaultFileBrowser,
    settingRegistry: ISettingRegistry,
    launcher: ILauncher | null
  ) => {
    console.log('JupyterLab extension jupyterlab-slurm is activated!');

    // Declare widgets
    let widget: SlurmWidget | null = null;
    let detailsTracker = new WidgetTracker<any>({ namespace: 'slurm-job-details' });

    const parsedSettings: ISlurmUserSettings = {
      itemsPerPageAuto: true,
      userOnly: true,
      itemsPerPage: 10,
      itemsPerPageOptions: [10, 15, 20, 25, 30, 40, 50],
      autoReload: false,
      autoReloadRate: 60
    };
    function loadSetting(setting: ISettingRegistry.ISettings): void {
      // Read the settings and convert to the correct type
      parsedSettings.itemsPerPageAuto = setting.get('itemsPerPageAuto')
        .composite as boolean;
      parsedSettings.userOnly = setting.get('userOnly').composite as boolean;
      parsedSettings.itemsPerPage = setting.get('itemsPerPage')
        .composite as number;
      parsedSettings.itemsPerPageOptions = setting.get('itemsPerPageOptions')
        .composite as Array<number>;
      parsedSettings.autoReload = setting.get('autoReload')
        .composite as boolean;
      parsedSettings.autoReloadRate = setting.get('autoReloadRate')
        .composite as number;
    }

    // Track and restore the widget state
    const tracker = new WidgetTracker<SlurmWidget>({ namespace: 'slurm' });
    restorer.restore(tracker, {
      command: COMMAND_ID_OPEN,
      // args: () => JSONExt.emptyObject,
      name: () => 'slurm'
    });

    const settings = await settingRegistry.load(PLUGIN_ID);
    loadSetting(settings);
    settings.changed.connect(loadSetting);
    // When settings change in the Settings Editor, refresh the widget so
    // the updated values propagate to the UI toggles/controls.
    settings.changed.connect(() => {
      if (widget) {
        widget.update();
      }
    });

    // add open command, when there is no active widget show the open label
    app.commands.addCommand(COMMAND_ID_OPEN, {
      label: 'Slurm Queue Manager',
      iconClass: SLURM_ICON_CLASS_LAUNCHER,
      execute: () => {
        if (!widget) {
          // Instantiate a new widget if one does not exist
          const fb = filebrowser as unknown as FileBrowser;
          widget = new SlurmWidget(
            app,
            fb,
            parsedSettings,
            settingRegistry
          );
          widget.title.iconClass = SLURM_ICON_CLASS_TAB;
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

    // Command to open/focus the Job Details tab with a snapshot of job IDs
    app.commands.addCommand(COMMAND_ID_SHOW_DETAILS, {
      label: 'Show job details',
      isEnabled: () => true,
      execute: async (args: any) => {
        const { JobDetailsWidget } = await import('./jobdetailsWidget');
        // Try to find an existing widget that is still usable
        let w = detailsTracker.currentWidget as any;
        // Check if widget exists, is not disposed, and is still attached
        if (!w || w.isDisposed || !w.isAttached) {
          w = new JobDetailsWidget(app);
          w.title.label = 'Job Details';
          app.shell.add(w, 'main');
          await detailsTracker.add(w);
        }
        const jobIds: string[] = Array.isArray(args?.jobIds) ? args.jobIds : [];
        const index: number = typeof args?.index === 'number' ? args.index : 0;
        w.setSnapshot(jobIds, index);
        app.shell.activateById(w.id);
      }
    });

    // Add the command to the palette.
    palette.addItem({
      command: COMMAND_ID_OPEN,
      category: 'HPC Tools',
      args: { isPalette: true }
    });

    // Add a launcher item if the launcher is available.
    if (launcher) {
      launcher.add({
        command: COMMAND_ID_OPEN,
        rank: 1,
        category: 'HPC Tools'
      });
    }

    // add options toggle command, when there is no active widget show the open label
    app.commands.addCommand(COMMAND_ID_TOGGLE_USERONLY, {
      label: 'Slurm Queue Manager',
      iconClass: SLURM_ICON_CLASS_LAUNCHER,
      execute: () => {
        if (!widget) {
          // Instantiate a new widget if one does not exist
          const fb = filebrowser as unknown as FileBrowser;
          widget = new SlurmWidget(
            app,
            fb,
            parsedSettings,
            settingRegistry
          );
          widget.title.iconClass = SLURM_ICON_CLASS_TAB;
        }

        widget.update();
      }
    });

    // add options toggle command, when there is no active widget show the open label
    app.commands.addCommand(COMMAND_ID_TOGGLE_AUTORELOAD, {
      label: 'Slurm Queue Manager',
      iconClass: SLURM_ICON_CLASS_LAUNCHER,
      execute: () => {
        if (!widget) {
          // Instantiate a new widget if one does not exist
          const fb = filebrowser as unknown as FileBrowser;
          widget = new SlurmWidget(
            app,
            fb,
            parsedSettings,
            settingRegistry
          );
          widget.title.iconClass = SLURM_ICON_CLASS_TAB;
        }

        widget.update();
      }
    });

    requestAPI<any>('get_example')
      .then(data => {
        console.log('get_example', data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_slurm server extension appears to have a problem starting.\n${reason}`
        );
      });
  }
};

export default extension;
