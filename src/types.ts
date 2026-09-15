import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

/**
 * The settings read from our plugin JSON
 */
export interface ISlurmUserSettings {
  itemsPerPageAuto: boolean;
  userOnly: boolean;
  itemsPerPage: number;
  itemsPerPageOptions: Array<number>;
  autoReload: boolean;
  autoReloadRate: number;
  // Persisted ag-grid column order/visibility/width/pinning for the queue
  // table (see `applyColumnState`/`getColumnState` in ag-grid). Managed
  // automatically; not meant to be hand-edited by users.
  columnState: Array<Record<string, any>>;
  // Notify (JupyterLab toast) when a tracked job's state changes, e.g.
  // RUNNING -> COMPLETED.
  notifyOnStateChange: boolean;
}

export type JobAction =
  | 'cancel'
  | 'hold'
  | 'release'
  | 'suspend'
  | 'resume'
  | 'requeue'
  | 'requeuehold';

export interface ISlurmWidgetProps extends ISlurmUserSettings {
  userName: string;
  reloadRate: number;
  jupyterlabFrontend: JupyterFrontEnd;
  settingRegistry: ISettingRegistry;
  // Whether this tab is currently visible/active. When the tab is kept mounted
  // (hidden via CSS) but not active, background polling is paused. Defaults to
  // true when omitted so existing callers/tests behave unchanged.
  active?: boolean;
}

export type DetailsResponse = {
  success: boolean;
  exitCode?: number;
  errorMessage?: string | null;
  data?: {
    source: 'scontrol' | 'sacct' | string;
    fields: Record<string, any>;
    steps?: Array<Record<string, any>>;
  };
};

export type UiDetailsConfig = {
  details_field_groups?: Record<string, string[]>;
  details_labels?: Record<string, string>;
  details_sources?: Record<string, string>;
  details_hidden?: Record<string, any>;
  // The Jupyter server's Contents root (`ServerApp.root_dir`), needed to
  // translate an absolute Slurm-reported path (Command/WorkDir/Stdout/
  // Stderr) into the root-relative path `docmanager`/`filebrowser` commands
  // require, and to detect when a path falls outside root_dir entirely (in
  // which case "Open in Editor"/"Open folder" can never work and should be
  // disabled rather than silently no-op).
  server_root_dir?: string | null;
};

export type SacctResponse = {
  success: boolean;
  exitCode: number;
  data: {
    columns: string[];
    rows: string[][];
  };
  errorMessage?: string | null;
  responseMessage?: string;
};
