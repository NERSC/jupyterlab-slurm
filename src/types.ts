/**
 * The settings read from our plugin JSON
 */
export interface ISlurmUserSettings {
  userOnly: boolean;
  queueCols: Array<string>;
  itemsPerPage: number;
  itemsPerPageOptions: Array<number>;
  autoReload: boolean;
  autoReloadRate: number;
}

export type JobAction = 'kill' | 'hold' | 'release';
