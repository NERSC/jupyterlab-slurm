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
}

export type JobAction = 'kill' | 'hold' | 'release';

// Legacy type removed: column definitions are now derived from the server
// response (squeue data.columns) and server-side UI config (SlurmUI).
