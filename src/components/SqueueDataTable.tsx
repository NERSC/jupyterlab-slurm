'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react';

import {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Fade,
  FormGroup,
  FormControlLabel,
  Snackbar,
  Alert,
  Switch,
  TextField
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DeselectIcon from '@mui/icons-material/Deselect';
import StopIcon from '@mui/icons-material/Stop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import Grid from '@mui/material/Grid2';

import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ClientSideRowModelModule,
  ITooltipParams,
  ModuleRegistry,
  RowSelectionModule,
  RowSelectionOptions,
  SelectionChangedEvent,
  ValidationModule,
  themeQuartz
} from 'ag-grid-community';

import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

// Local
import { requestAPI } from '../handler';
import { JobAction } from '../types';
import Props = types.Props;
import { PLUGIN_ID, COMMAND_ID_SHOW_DETAILS } from '../index';
// Bundled deployment UI defaults (labels/sizing). These are merged with
// server-provided values from /ui-config, where server values take precedence.
// This ensures column header labels (e.g., PARTITION → QOS) are applied even
// if the server isn't configured with SlurmUI traitlets.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - allow JSON import without explicit typings
import bundledUi from '../../jupyter-config/jupyter_server_config.d/jupyterlab-slurm-ui.json';

namespace types {
  export type Props = {
    itemsPerPageAuto: boolean;
    itemsPerPage: number;
    itemsPerPageOptions: Array<number>;
    userOnly: boolean;
    userName: string;
    autoReload: boolean;
    reloadRate: number;
    jupyterlabFrontend: JupyterFrontEnd;
    settingRegistry: ISettingRegistry;
  };
}

// Register all Community features
ModuleRegistry.registerModules([
  AllCommunityModule,
  ClientSideRowModelModule,
  RowSelectionModule,
  ValidationModule
]);

const JOB_STATUS_CODES: Record<string, Record<string, string>> = {
  BF: {
    name: 'BOOT_FAIL',
    description:
      'Job terminated due to launch failure, typically due to a hardware failure (e.g. unable to boot the node or block and the job can not be requeued).'
  },
  CA: {
    name: 'CANCELLED',
    description:
      'Job was explicitly cancelled by the user or system administrator. The job may or may not have been initiated.'
  },
  CD: {
    name: 'COMPLETED',
    description:
      'Job has terminated all processes on all nodes with an exit code of zero.'
  },
  CF: {
    name: 'CONFIGURING',
    description:
      'Job has been allocated resources, but are waiting for them to become ready for use (e.g. booting).'
  },
  CG: {
    name: 'COMPLETING',
    description:
      'Job is in the process of completing. Some processes on some nodes may still be active.'
  },
  DL: { name: 'DEADLINE', description: 'Job terminated on deadline.' },
  F: {
    name: 'FAILED',
    description:
      'Job terminated with non-zero exit code or other failure condition.'
  },
  NF: {
    name: 'NODE_FAIL',
    description: 'Job terminated due to failure of one or more allocated nodes.'
  },
  OOM: {
    name: 'OUT_OF_MEMORY',
    description: 'Job experienced out of memory error.'
  },
  PD: { name: 'PENDING', description: 'Job is awaiting resource allocation.' },
  PR: { name: 'PREEMPTED', description: 'Job terminated due to preemption.' },
  R: { name: 'RUNNING', description: 'Job currently has an allocation.' },
  RD: {
    name: 'RESV_DEL_HOLD',
    description: 'Job is being held after requested reservation was deleted.'
  },
  RF: {
    name: 'REQUEUE_FED',
    description: 'Job is being requeued by a federation.'
  },
  RH: { name: 'REQUEUE_HOLD', description: 'Held job is being requeued.' },
  RQ: { name: 'REQUEUED', description: 'Completing job is being requeued.' },
  RS: { name: 'RESIZING', description: 'Job is about to change size.' },
  RV: {
    name: 'REVOKED',
    description:
      'Sibling was removed from cluster due to other cluster starting the job.'
  },
  SI: { name: 'SIGNALING', description: 'Job is being signaled.' },
  SE: {
    name: 'SPECIAL_EXIT',
    description:
      'The job was requeued in a special state. This state can be set by users, typically in EpilogSlurmctld, if the job has terminated with a particular exit value.'
  },
  SO: { name: 'STAGE_OUT', description: 'Job is staging out files.' },
  ST: {
    name: 'STOPPED',
    description:
      'Job has an allocation, but execution has been stopped with SIGSTOP signal. CPUS have been retained by this job.'
  },
  S: {
    name: 'SUSPENDED',
    description:
      'Job has an allocation, but execution has been suspended and CPUs have been released for other jobs.'
  },
  TO: {
    name: 'TIMEOUT',
    description: 'Job terminated upon reaching its time limit.'
  }
};

export default function SqueueDataTable(props: Props) {
  const [rows, setRows] = useState<string[][]>([]);
  const [serverColumns, setServerColumns] = useState<string[]>([]);
  const [uiLabels, setUiLabels] = useState<Record<string, string>>({});
  const [uiSizing, setUiSizing] = useState<Record<string, any>>({});
  const [selectedRows, setSelectedRows] = useState([]);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [clearSelected, setClearSelected] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [lastSqueueFetch, setLastSqueueFetch] = useState(
    new Date('1970-01-01')
  );
  const [nextAvailableSqueueFetch, setNextAvailableSqueueFetch] =
    useState<Date | null>(null);
  const [autoReload, setAutoReload] = useState<boolean>(props.autoReload);
  const [reloadRate, setReloadRate] = useState(props.reloadRate * 1000);
  const [reloadQueue, setReloadQueue] = useState(false);
  const [disableManualRefresh, setDisableManualRefresh] = useState(
    !props.autoReload
  );
  // Server-provided minimum interval between squeue reloads (ms).
  // Defaults to 5000ms if server does not provide a value.
  const [reloadLimitMs, setReloadLimitMs] = useState<number>(5000);
  const [userOnly, setUserOnly] = useState(props.userOnly);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState('default');
  const [displayRows, setDisplayRows] = useState<Record<string, unknown>[]>([]);
  // by default, Slurm column id for Job ID is 'JOBID'
  const jobIDLabel = serverColumns.includes('JOBID')
    ? 'JOBID'
    : serverColumns.length > 0
      ? serverColumns[0]
      : 'JOBID';
  const gridApiRef = useRef<any>(null);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Remount key for AgGrid when initial-only props must change
  const gridKey = useMemo(() => {
    const opts = Array.isArray(props.itemsPerPageOptions)
      ? props.itemsPerPageOptions.join(',')
      : '';
    return `squeue-${props.itemsPerPageAuto}-${opts}`;
  }, [props.itemsPerPageAuto, props.itemsPerPageOptions]);

  // Ensure itemsPerPage is one of the allowed options when auto is disabled
  const effectivePageSize = useMemo(() => {
    const options = Array.isArray(props.itemsPerPageOptions)
      ? props.itemsPerPageOptions
      : [];
    if (!options || options.length === 0) {
      return props.itemsPerPage;
    }
    return options.includes(props.itemsPerPage)
      ? props.itemsPerPage
      : options[0];
  }, [props.itemsPerPage, props.itemsPerPageOptions]);

  // Helper: re-apply grid filters based on current component state.
  const reapplyGridFilters = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    try {
      // User-only column filter
      if (userOnly) {
        api.setColumnFilterModel('USER', {
          filterType: 'text',
          type: 'equals',
          filter: props.userName
        });
      } else {
        api.setColumnFilterModel('USER', null);
      }
      // Quick filter (text)
      api.setQuickFilter(filterQuery || null);
      if (api.onFilterChanged) {
        api.onFilterChanged();
      }
    } catch (e) {
      // no-op
    }
  }, [userOnly, props.userName, filterQuery]);

  const onGridReady = useCallback(
    (params: any) => {
      gridApiRef.current = params.api;
      try {
        // Use a small timeout to ensure the grid is fully initialized before applying filters
        setTimeout(() => {
          reapplyGridFilters();
          const sz = params.api.getGridSize ? params.api.getGridSize() : null;
          if (!sz || (sz && sz.width > 0)) {
            params.api.sizeColumnsToFit();
          }
        }, 50);
      } catch (e) {
        // no-op
      }
    },
    [reapplyGridFilters]
  );

  // Ensure Ag Grid quick filter updates immediately when the text input changes,
  // including when the filter is cleared back to an empty string.
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api) return;
    try {
      // Passing empty string should clear the quick filter; use null fallback for safety.
      api.setQuickFilter(filterQuery || null);
      if (api.onFilterChanged) {
        api.onFilterChanged();
      }
    } catch (e) {
      // no-op
    }
  }, [filterQuery]);

  const sizeColumnsToFitSafe = useCallback(() => {
    if (!gridApiRef.current) {
      return;
    }
    try {
      // Also ensure filters are applied when data is rendered/resized
      reapplyGridFilters();

      const sz = gridApiRef.current.getGridSize
        ? gridApiRef.current.getGridSize()
        : null;
      if (!sz || (sz && sz.width > 0)) {
        gridApiRef.current.sizeColumnsToFit();
      }
    } catch (e) {
      // ignore
    }
  }, [reapplyGridFilters]);

  // Note: do not set state during render; clamping is handled in an effect below.

  const body = document.getElementsByTagName('body')[0];
  const observer = new MutationObserver(mutationRecords => {
    if (mutationRecords[0].oldValue === 'true' && theme === 'default') {
      setTheme('dark');
    } else {
      setTheme('default');
    }
  });
  observer.observe(body, {
    attributes: true,
    attributeFilter: ['data-jp-theme-light'],
    attributeOldValue: true
  });

  // Fetch deployment-only UI config once: labels and sizing hints
  useEffect(() => {
    (async () => {
      try {
        const resp = await requestAPI<any>('ui-config');
        if (resp && resp.success && resp.data) {
          const bundledLabels =
            (bundledUi && bundledUi.SlurmUI && bundledUi.SlurmUI.queue_column_labels) || {};
          const bundledSizing =
            (bundledUi && bundledUi.SlurmUI && bundledUi.SlurmUI.queue_column_sizing) || {};

          const labels = resp.data.queue_column_labels || {};
          const sizing = resp.data.queue_column_sizing || {};

          // Merge bundled defaults with server-provided values. Server wins.
          setUiLabels({ ...bundledLabels, ...labels });
          setUiSizing({ ...bundledSizing, ...sizing });
          // Pick up server-provided reload limit (ms) if present and valid
          const limit = resp.data.squeue_reload_limit_ms;
          if (typeof limit === 'number' && isFinite(limit) && limit > 0) {
            setReloadLimitMs(limit);
          }
        }
      } catch (e) {
        console.warn('Failed to load /ui-config; using bundled defaults', e);
        // Fall back to bundled defaults entirely
        try {
          const bundledLabels =
            (bundledUi && bundledUi.SlurmUI && bundledUi.SlurmUI.queue_column_labels) || {};
          const bundledSizing =
            (bundledUi && bundledUi.SlurmUI && bundledUi.SlurmUI.queue_column_sizing) || {};
          setUiLabels(bundledLabels);
          setUiSizing(bundledSizing);
        } catch (e2) {
          // no-op if bundled file cannot be read
        }
      }
    })();
  }, []);

  // Sync local state when external settings change in the Settings panel
  useEffect(() => {
    if (props.userOnly !== userOnly) {
      setUserOnly(props.userOnly);
    }
  }, [props.userOnly]);

  useEffect(() => {
    if (props.autoReload !== autoReload) {
      setAutoReload(props.autoReload);
    }
  }, [props.autoReload]);

  useEffect(() => {
    const nextMs = props.reloadRate * 1000;
    if (nextMs !== reloadRate) {
      setReloadRate(nextMs);
    }
  }, [props.reloadRate]);

  // Clamp reloadRate to server-enforced minimum (reloadLimitMs)
  useEffect(() => {
    if (reloadRate < reloadLimitMs) {
      console.log(
        `jupyterlab-slurm: reloadRate ${reloadRate}ms is below server limit ${reloadLimitMs}ms; clamping.`
      );
      setReloadRate(reloadLimitMs);
    }
  }, [reloadRate, reloadLimitMs]);

  useEffect(() => {
    //console.debug('useEffect');
    async function getData(rateLimit = 0): Promise<void> {
      if (loading) {
        return;
      }

      if (rateLimit > 0) {
        const currentDT = new Date();
        const delta = Number(currentDT) - Number(lastSqueueFetch);
        if (delta < rateLimit) {
          return;
        }
      }

      setLoading(true);

      await requestAPI<any>('squeue')
        .then(data => {
          //console.log('SqueueDataTable getData() squeue', data);
          const current = new Date();
          setLastSqueueFetch(current);
          setLoading(false);
          // Server returns { success, data: { rows, columns } }
          const rows =
            data && data.data && Array.isArray(data.data.rows)
              ? data.data.rows
              : [];
          const cols =
            data && data.data && Array.isArray(data.data.columns)
              ? data.data.columns
              : [];
          setRows(rows.slice());
          setServerColumns(cols.slice());
          // After data arrives, try to resize columns to fit width for readability
          sizeColumnsToFitSafe();
          if (autoReload) {
            setNextAvailableSqueueFetch(
              new Date(current.getTime() + reloadRate)
            );
          } else {
            setNextAvailableSqueueFetch(null);
          }
        })
        .catch(error => {
          console.error('SqueueDataTable getData() error', error);
        });
    }

    if (reloadQueue || rows.length === 0) {
      getData(reloadLimitMs).then(() => {
        console.debug('data loaded');
        setReloadQueue(false);
      });
    }
  }, [reloadQueue, reloadLimitMs]);

  // Keep pagination settings in sync if user changes them in Settings panel
  useEffect(() => {
    if (!gridApiRef.current) {
      return;
    }
    try {
      if (props.itemsPerPageAuto) {
        gridApiRef.current.setGridOption('paginationAutoPageSize', true);
      } else {
        gridApiRef.current.setGridOption('paginationAutoPageSize', false);
        gridApiRef.current.setGridOption(
          'paginationPageSize',
          effectivePageSize
        );
      }
    } catch (e) {
      // ignore
    }
  }, [props.itemsPerPageAuto, props.itemsPerPageOptions, effectivePageSize]);

  // Observe container size and fit columns when it becomes visible (> 0 width)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    let rafId = 0 as any;
    let lastWidth = 0;
    const ro = new (window as any).ResizeObserver((entries: any) => {
      const w = el.offsetWidth || 0;
      if (w > 0 && w !== lastWidth) {
        const wasHidden = lastWidth === 0;
        lastWidth = w;
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
          sizeColumnsToFitSafe();
          if (wasHidden) {
            // When the grid becomes visible again (e.g., returning to the tab),
            // re-apply column + quick filters so they are respected.
            reapplyGridFilters();
          }
        });
      }
    });
    ro.observe(el);
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      ro.disconnect();
    };
  }, [sizeColumnsToFitSafe, reapplyGridFilters]);

  // If we had to coerce the page size because it wasn't in the options, persist the fix
  useEffect(() => {
    const needsCoerce = props.itemsPerPage !== effectivePageSize;
    if (!needsCoerce) {
      return;
    }
    (async () => {
      try {
        const settings = await props.settingRegistry.load(PLUGIN_ID);
        await settings.set('itemsPerPage', effectivePageSize);
      } catch (error) {
        console.error('Failed to persist coerced itemsPerPage setting:', error);
      }
    })();
  }, [effectivePageSize, props.itemsPerPage, props.settingRegistry]);

  useEffect(() => {
    // Re-apply grid filters when the userOnly toggle changes
    reapplyGridFilters();
    // Update settings inline
    (async () => {
      try {
        const settings = await props.settingRegistry.load(PLUGIN_ID);
        await settings.set('userOnly', userOnly);
      } catch (error) {
        console.error('Failed to update userOnly setting:', error);
      }
    })();
  }, [userOnly, reapplyGridFilters, props.settingRegistry]);

  useEffect(() => {
    console.debug('autoReload effect');
    console.debug('Current state:', {
      autoReload,
      reloadQueue,
      reloadRate,
      currentIntervalId: intervalIdRef.current
    });
    //props.jupyterlabFrontend.commands.execute(COMMAND_ID_TOGGLE_AUTORELOAD);
    if (autoReload) {
      setDisableManualRefresh(true);
      // if auto refresh is enabled or re-enabled
      if (intervalIdRef.current === null) {
        console.debug('Setting next queue fetch time');
        setNextAvailableSqueueFetch(
          new Date(new Date().getTime() + reloadRate)
        );
      } else {
        console.debug(
          'Interval already exists, not setting next queue fetch time'
        );
      }
      // trigger a data fetch at the reload interval
      const reloadCycle = () => {
        intervalIdRef.current = setInterval(() => {
          console.debug('Interval fired');
          if (autoReload) {
            console.debug('autoReload is true, setting reloadQueue to true');
            setReloadQueue(true);
          }
        }, reloadRate);
      };
      reloadCycle();
    } else {
      console.debug('Auto-reload disabled, clearing interval');
      if (intervalIdRef.current !== null) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      setNextAvailableSqueueFetch(null);
      console.debug('Setting reloadQueue to false');
      setReloadQueue(false);
      setDisableManualRefresh(false);
    }
    // Update settings inline
    (async () => {
      try {
        const settings = await props.settingRegistry.load(PLUGIN_ID);
        await settings.set('autoReload', autoReload);
      } catch (error) {
        console.error('Failed to update autoReload setting:', error);
      }
    })();
  }, [reloadRate, autoReload]);

  useEffect(() => {
    updateDisplayRows();
  }, [rows, serverColumns]);

  useEffect(() => {
    if (clearSelected && gridApiRef.current) {
      gridApiRef.current.deselectAll();
      setSelectedRows([]);
      setClearSelected(false);
    }
  }, [clearSelected]);

  function _parseTimeInSeconds(t: string): number {
    const splits: string[] = t.split(':');
    let days = 0;
    let hours = 0;
    let seconds = 0;

    switch (splits.length) {
      case 3:
        if (splits[0].indexOf('-') > -1) {
          days = Number(splits[0].split('-')[0]);
          hours = Number(splits[0].split('-')[1]) + days * 24;
        } else {
          hours = Number(splits[0]);
        }
        seconds = hours * 3600 + Number(splits[1]) * 60 + Number(splits[2]);
        break;
      case 2:
        seconds = Number(splits[0]) * 60 + Number(splits[1]);
        break;
      default:
        console.error(splits);
    }

    return seconds;
  }

  // Build a stable numeric sort key for Slurm job IDs.
  // Supported forms:
  //   - "1234" (plain job)
  //   - "1234_5" (array element)
  //   - "1234_[1,3-5,10]" (array short form, we use the minimal element for ordering)
  // Ordering intent (ascending):
  //   1) Primary by base ID (the integer before the first underscore)
  //   2) Within same base: plain job first, then array entries ordered by their minimal element
  // Implementation detail: we map (base, kind, sub) -> a single numeric key as base*FACTOR + (sub+1 or 0)
  // where plain jobs get the smallest offset (0), and array entries get (minElement+1).
  // We use FACTOR=1e6 to safely separate bases while staying within JS safe integer range for typical Slurm scales.
  function _parseJobID(jobId: string): number {
    try {
      const trimmed = jobId.trim();
      if (trimmed.length === 0) {
        return Number.MAX_SAFE_INTEGER;
      }

      // Extract base and optional suffix after underscore
      const match = trimmed.match(/^(\d+)(?:_(.+))?$/);
      if (!match) {
        // Not a recognizable numeric job id; push to bottom
        const asNum = Number(trimmed);
        return Number.isFinite(asNum) ? asNum : Number.MAX_SAFE_INTEGER;
      }

      const base = Number(match[1]);
      const suffix = match[2];
      const FACTOR = 1_000_000; // keep well within 53-bit integer for typical bases

      if (!suffix) {
        // Plain job: sub offset 0 so it sorts before any array entries of same base
        return base * FACTOR;
      }

      // Array single index: e.g., "5"
      // Array short form: e.g., "[1,3-5,10]"
      let subMin = Number.MAX_SAFE_INTEGER;
      if (suffix.startsWith('[') && suffix.endsWith(']')) {
        const inner = suffix.slice(1, -1);
        for (const token of inner.split(',')) {
          const part = token.trim();
          if (!part) {
            continue;
          }
          if (part.includes('-')) {
            const [start] = part.split('-', 1);
            const n = Number(start);
            if (Number.isFinite(n)) {
              subMin = Math.min(subMin, n);
            }
          } else {
            const n = Number(part);
            if (Number.isFinite(n)) {
              subMin = Math.min(subMin, n);
            }
          }
        }
      } else {
        const n = Number(suffix);
        if (Number.isFinite(n)) {
          subMin = n;
        }
      }

      if (!Number.isFinite(subMin) || subMin === Number.MAX_SAFE_INTEGER) {
        // Malformed array suffix; put after plain within base
        return base * FACTOR + (FACTOR - 1);
      }

      // Array entries: offset by (subMin + 1) so that plain (0) < array(>=1)
      const offset = subMin + 1;
      // Guard against pathological huge offsets by capping at FACTOR-1
      const safeOffset = Math.min(Math.max(1, offset), FACTOR - 1);
      return base * FACTOR + safeOffset;
    } catch (e) {
      // Any parsing errors: push to bottom
      return Number.MAX_SAFE_INTEGER;
    }
  }

  function _getRowId(params: any): any {
    return params.data[jobIDLabel];
  }

  function createDisplayColumnsFromServer(ids: string[]) {
    if (!ids || ids.length === 0) {
      return [] as any[];
    }
    return ids.map(id => {
      const col: Record<string, unknown> = {
        field: id,
        headerName: uiLabels[id] ?? id
      };
      // Type inference for comparators/filters based on common Squeue ids
      if (id === 'NODES') {
        col['filter'] = 'agNumberColumnFilter';
        col['comparator'] = function (valueA: any, valueB: any): number {
          return Number(valueA) - Number(valueB);
        };
      } else if (id === 'TIME') {
        col['comparator'] = function (valueA: any, valueB: any): number {
          const secondsA = _parseTimeInSeconds(valueA);
          const secondsB = _parseTimeInSeconds(valueB);
          return secondsA - secondsB;
        };
      } else if (id === 'JOBID') {
        col['comparator'] = function (valueA: any, valueB: any): number {
          const idA = _parseJobID(valueA);
          const idB = _parseJobID(valueB);
          return idA - idB;
        };
      }

      // Prefer a friendly header for Job Status even if the server didn't
      // provide a label mapping.
      if ((id === 'ST' || id === 'STATE') && !uiLabels[id]) {
        col['headerName'] = 'Job Status';
      }

      if (id === 'ST' || id === 'STATE') {
        // Roll back to a simple text filter for Job Status for now.
        col['filter'] = 'agTextColumnFilter';
        col['floatingFilter'] = false;

        // Display: convert short codes (R/PD/...) to human-readable names for UX.
        // This affects only the rendered value; the underlying data stays as the code.
        (col as any)['valueFormatter'] = (p: any) => {
          const code = p?.value ?? '';
          if (code && Object.prototype.hasOwnProperty.call(JOB_STATUS_CODES, code)) {
            return JOB_STATUS_CODES[code].name;
          }
          return code;
        };

        // Quick filter should match descriptive name as well as code.
        (col as any)['getQuickFilterText'] = (p: any) => {
          const code = p?.value ?? '';
          const name = code && Object.prototype.hasOwnProperty.call(JOB_STATUS_CODES, code)
            ? JOB_STATUS_CODES[code].name
            : '';
          return [code, name].filter(Boolean).join(' ');
        };

        // Preserve rich tooltips mapping codes to descriptive text
        col['tooltipValueGetter'] = (p: ITooltipParams) => {
          if (
            p.value &&
            Object.prototype.hasOwnProperty.call(JOB_STATUS_CODES, p.value)
          ) {
            const status_name = JOB_STATUS_CODES[p.value]['name'];
            const status_description = JOB_STATUS_CODES[p.value]['description'];
            return `${status_name}: ${status_description}`;
          }
          return '';
        };
      } else {
        col['tooltipValueGetter'] = (p: ITooltipParams) => {
          return `${p.value ?? ''}`;
        };
      }

      // Apply server-provided sizing hints if present
      const sizing = uiSizing[id];
      if (sizing && typeof sizing === 'object') {
        Object.assign(col, sizing);
      }

      return col;
    });
  }

  function clearSelectedRows(): void {
    setClearSelected(true);
  }

  function handleUserOnlyClick() {
    setUserOnly(!userOnly);
  }

  function handleAutoReloadClick() {
    setAutoReload(!autoReload);
  }

  function handleJobAction(action: JobAction): void {
    processSelectedJobs(action, selectedRows);

    if (action === 'kill') {
      clearSelectedRows();
    }
  }

  async function processSelectedJobs(
    action: JobAction,
    rows: Record<string, unknown>[]
  ): Promise<void> {
    //console.log(`processSelectedJobs(${action}, rows)`);
    const { route, method } = (action => {
      switch (action) {
        case 'kill':
          return { route: 'scancel', method: 'DELETE' };
        case 'hold':
          return { route: 'scontrol/hold', method: 'PATCH' };
        case 'release':
          return { route: 'scontrol/release', method: 'PATCH' };
      }
    })(action);

    const jobIDs = rows.map(row => {
      return String(row[jobIDLabel]);
    });
    console.debug(jobIDs);

    const body = JSON.stringify({ job_ids: jobIDs });
    console.debug(body);

    try {
      //console.log(`Request for ${method} ${route}`);
      requestAPI<any>(route, new URLSearchParams(), {
        body: body,
        method: method,
        headers: { 'Content-Type': 'application/json' }
      }).then(async result => {
        //console.log('makeJobRequest()', result);

        if (result.returncode === 0) {
          // trigger a refresh of the table
          setReloadQueue(true);
        } else {
          console.error(result.errorMessage);
        }
      });
    } catch (reason) {
      console.error(`Error on ${method} ${route}\n${reason}`);
    }
  }

  function updateDisplayRows() {
    //console.debug('updateDisplayRows');

    const updateRows = rows.map((x: string[]) => {
      //console.debug(x);
      const item: Record<string, unknown> = {};
      for (let col = serverColumns.length - 1; col >= 0; col--) {
        const colId = serverColumns[col];
        item[colId] = x[col];
      }

      /*
      if (selectedRows.length > 0) {
        const matches = selectedRows.map((s: string[]) => {
          return x[colJobID] === s[colJobID];
        });
        console.debug(matches);
      }*/

      //console.log(item);

      return item;
    });

    //console.log(updateRows);
    setDisplayRows(updateRows);
  }

  // Build column defs from server columns with UI overrides
  const displayColumns = useMemo(() => {
    return createDisplayColumnsFromServer(serverColumns);
  }, [serverColumns, uiLabels, uiSizing]);

  // Build a fast lookup for selected ids
  const selectedIdSet = useMemo(() => {
    try {
      return new Set(
        (selectedRows as Record<string, unknown>[]).map(r =>
          String((r as any)[jobIDLabel])
        )
      );
    } catch {
      return new Set<string>();
    }
  }, [selectedRows, jobIDLabel]);

  // Option: only show selected rows
  const effectiveRowData = useMemo(() => {
    if (!showSelectedOnly) return displayRows;
    if (!selectedIdSet || selectedIdSet.size === 0) return [] as any[];
    return displayRows.filter(r => selectedIdSet.has(String((r as any)[jobIDLabel])));
  }, [showSelectedOnly, displayRows, selectedIdSet, jobIDLabel]);

  function onReloadButtonClick() {
    if (!reloadQueue) {
      // do not support spamming the button
      setDisableManualRefresh(true);
      setInterval(() => {
        setDisableManualRefresh(false);
      }, reloadRate);
      // trigger a data fetch at the reload interval
      setReloadQueue(true);
    }
  }

  function onSelectionChanged(event: SelectionChangedEvent) {
    if (gridApiRef && gridApiRef.current) {
      //console.log('Selection updated');
      setSelectedRows(gridApiRef.current.getSelectedRows());
    }
  }

  // Collect selected JOBIDs in the current display order of the grid
  const getSelectedJobIdsInDisplayOrder = useCallback((): string[] => {
    const api = gridApiRef.current;
    if (!api) return [];
    const ids: string[] = [];
    const count = api.getDisplayedRowCount ? api.getDisplayedRowCount() : 0;
    for (let i = 0; i < count; i++) {
      const row = api.getDisplayedRowAtIndex(i);
      if (row && row.isSelected && row.isSelected()) {
        const data = row.data || {};
        const id = (data['JOBID'] ?? data['JobID'] ?? data['Id'] ?? '').toString();
        if (id) ids.push(id);
      }
    }
    return ids;
  }, []);

  const onShowDetails = useCallback(() => {
    const jobIds = getSelectedJobIdsInDisplayOrder();
    if (jobIds.length === 0) return;
    try {
      const result = props.jupyterlabFrontend.commands.execute(
        COMMAND_ID_SHOW_DETAILS,
        { jobIds, index: 0 }
      );
      // Some command implementations return a promise; handle rejection to surface UI error
      if (result && typeof (result as any).then === 'function') {
        (result as Promise<any>).catch(e => {
          // eslint-disable-next-line no-console
          console.error('Failed to open Job Details', e);
          setErrorMessage(
            'Failed to open Job Details. You may not have permission to view one or more selected jobs.'
          );
          setErrorOpen(true);
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to open Job Details', e);
      setErrorMessage(
        'Failed to open Job Details. You may not have permission to view one or more selected jobs.'
      );
      setErrorOpen(true);
    }
  }, [getSelectedJobIdsInDisplayOrder, props.jupyterlabFrontend]);

  const defaultColDef = {
    editable: false,
    flex: 1,
    filter: true,
    resizable: true,
    minWidth: 120,
    // Allow long header labels to wrap and auto-size the header row height
    wrapHeaderText: true as any,
    autoHeaderHeight: true as any,
    // Row data: do not auto-wrap or auto-grow rows; rely on tooltips for full content
    wrapText: false as any,
    autoHeight: false as any
  };
  const rowSelection: RowSelectionOptions = {
    mode: 'multiRow',
    selectAll: 'filtered',
    checkboxes: true,
    headerCheckbox: true,
    enableClickSelection: true
  };

  /*
  console.log({
    loading: loading,
    columns: displayColumns,
    selectedRows: selectedRows,
    displayRows: displayRows
  });*/

  return (
    <div className="jp-SlurmWidget-content">
      <Grid container className={'jp-SlurmWidget-row'}>
        <Grid>
          <TextField
            className="jp-SlurmWidget-table-filter-input"
            label={'Filter with text'}
            variant="outlined"
            size="small"
            margin="dense"
            InputLabelProps={{ shrink: true }}
            value={filterQuery}
            onChange={event => {
              setFilterQuery(event.target.value);
            }}
          />
          <ButtonGroup size="small">
            <Fade in={!autoReload} unmountOnExit mountOnEnter>
              <Button
                onClick={onReloadButtonClick}
                disabled={disableManualRefresh}
              >
                <ReplayIcon />
                Refresh
              </Button>
            </Fade>
            <Button
              disabled={selectedRows.length === 0}
              onClick={clearSelectedRows}
            >
              <DeselectIcon />
              Clear Selected
              {selectedRows.length > 0 && (
                <Badge
                  className={'jp-SlurmWidget-table-button-badge'}
                  badgeContent={selectedRows.length}
                  color={'secondary'}
                />
              )}
            </Button>
            <Button
              className="jp-SlurmWidget-table-button"
              disabled={selectedRows.length === 0}
              onClick={onShowDetails}
            >
              Show details
              {selectedRows.length > 0 && (
                <Badge
                  className={'jp-SlurmWidget-table-button-badge'}
                  badgeContent={getSelectedJobIdsInDisplayOrder().length}
                  color={'secondary'}
                />
              )}
            </Button>
            <Button
              className="jp-SlurmWidget-table-button"
              disabled={selectedRows.length === 0}
              onClick={() => {
                handleJobAction('kill');
              }}
            >
              <DeleteIcon />
              Kill Job(s)
              {selectedRows.length > 0 && (
                <Badge
                  className={'jp-SlurmWidget-table-button-badge'}
                  badgeContent={selectedRows.length}
                  color={'secondary'}
                />
              )}
            </Button>
            <Button
              disabled={selectedRows.length === 0}
              onClick={() => {
                handleJobAction('hold');
              }}
            >
              <StopIcon />
              Hold Job(s)
              {selectedRows.length > 0 && (
                <Badge
                  className={'jp-SlurmWidget-table-button-badge'}
                  badgeContent={selectedRows.length}
                  color={'secondary'}
                />
              )}
            </Button>
            <Button
              disabled={selectedRows.length === 0}
              onClick={() => {
                handleJobAction('release');
              }}
            >
              <PlayArrowIcon />
              Release Job(s)
              {selectedRows.length > 0 && (
                <Badge
                  className={'jp-SlurmWidget-table-button-badge'}
                  badgeContent={selectedRows.length}
                  color={'secondary'}
                />
              )}
            </Button>
          </ButtonGroup>
        </Grid>
        <Grid className="jp-SlurmWidget-table-toggle-options">
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  id="queue-auto-reload"
                  className="jp-SlurmWidget-queue-auto-reload"
                  checked={autoReload}
                  onChange={handleAutoReloadClick}
                />
              }
              label="Queue auto refresh"
            />
          </FormGroup>
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  id="user-only-checkbox"
                  className="jp-SlurmWidget-user-only-checkbox"
                  checked={userOnly}
                  onChange={handleUserOnlyClick}
                />
              }
              label="Only show my jobs"
            />
          </FormGroup>
        </Grid>
      </Grid>
      <Grid container>
        <Box
          sx={{
            paddingLeft: '15px',
            paddingRight: '15px',
            marginBottom: '8px'
          }}
        >
          <div className={'jp-SlurmWidget-status'}>
            <div>
              Last updated: {lastSqueueFetch.toLocaleDateString()}{' '}
              {lastSqueueFetch.toLocaleTimeString()}
            </div>
            {nextAvailableSqueueFetch && (
              <div>
                Next Queue Fetch:{' '}
                {nextAvailableSqueueFetch.toLocaleDateString()}{' '}
                {nextAvailableSqueueFetch.toLocaleTimeString()}
              </div>
            )}
          </div>
        </Box>
      </Grid>
      <div className={'jp-SlurmWidget-table'} ref={containerRef}>
        <AgGridReact
          key={gridKey}
          // Use a slightly taller, more readable grid like Job History
          theme={React.useMemo(
            () => themeQuartz.withParams({ headerHeight: 34, rowHeight: 30 }),
            []
          )}
          // Show tooltips faster and hide immediately to reduce perceived lag
          tooltipShowDelay={150 as any}
          tooltipHideDelay={0 as any}
          rowData={effectiveRowData}
          onGridReady={onGridReady}
          columnDefs={displayColumns}
          pagination={true}
          // Pagination sizing: auto when enabled, otherwise use fixed page size
          {...(props.itemsPerPageAuto
            ? {
                paginationAutoPageSize: true as any,
                paginationPageSizeSelector: false as any
              }
            : {
                paginationAutoPageSize: false as any,
                paginationPageSize: effectivePageSize,
                paginationPageSizeSelector: props.itemsPerPageOptions
              })}
          rowSelection={rowSelection}
          defaultColDef={defaultColDef}
          onSelectionChanged={onSelectionChanged}
          quickFilterText={filterQuery}
          getRowId={_getRowId}
          suppressModelUpdateAfterUpdateTransaction={true}
          // Prefer columns to fit the available grid width for better readability
          onFirstDataRendered={sizeColumnsToFitSafe}
          onGridSizeChanged={sizeColumnsToFitSafe}
        />
      </div>
      {/* Controls column: switches on the right */}
      <Grid container>
        <Grid className="jp-SlurmWidget-table-toggle-options">
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  id="show-selected-only"
                  className="jp-SlurmWidget-show-selected-only"
                  checked={showSelectedOnly}
                  onChange={(_, v) => setShowSelectedOnly(v)}
                />
              }
              label="Show selected only"
            />
          </FormGroup>
        </Grid>
      </Grid>

      {/* Error Snackbar for user-visible failures (e.g., Job Details not permitted) */}
      <Snackbar
        open={errorOpen}
        autoHideDuration={6000}
        onClose={() => setErrorOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setErrorOpen(false)}
          severity="error"
          sx={{ width: '100%' }}
        >
          {errorMessage}
        </Alert>
      </Snackbar>
    </div>
  );
}
