import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { requestAPI } from '../handler';
import { JobAction, ISlurmWidgetProps } from '../types';
import { PLUGIN_ID } from '../index';
import { SelectionChangedEvent } from 'ag-grid-community';
// Import from the package root (not a deep `lib/...` path), see
// SqueueDataTable.tsx for why: it keeps the module-federation-shared
// `Notification.manager` singleton in sync with the running shell's toasts.
import { Notification } from '@jupyterlab/apputils';

export function useSlurmQueue(props: ISlurmWidgetProps) {
  const [rows, setRows] = useState<string[][]>([]);
  const [serverColumns, setServerColumns] = useState<string[]>([]);
  const [uiLabels, setUiLabels] = useState<Record<string, string>>({});
  const [uiSizing, setUiSizing] = useState<Record<string, any>>({});
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [lastSqueueFetch, setLastSqueueFetch] = useState(
    new Date('1970-01-01')
  );
  const [nextAvailableSqueueFetch, setNextAvailableSqueueFetch] =
    useState<Date | null>(null);
  const [autoReload, setAutoReload] = useState<boolean>(props.autoReload);
  const reloadRate = props.reloadRate * 1000;
  // When the queue tab is kept mounted but hidden, `active` is false and we
  // pause background polling / initial fetches. Defaults to true when omitted.
  const active = props.active !== false;
  const [reloadQueue, setReloadQueue] = useState(false);
  const [disableManualRefresh, setDisableManualRefresh] = useState(
    !props.autoReload
  );
  const [reloadLimitMs, setReloadLimitMs] = useState<number>(5000);
  const [userOnly, setUserOnly] = useState(props.userOnly);
  const [loading, setLoading] = useState(false);
  const [displayRows, setDisplayRows] = useState<Record<string, unknown>[]>([]);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successOpen, setSuccessOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const gridApiRef = useRef<any>(null);
  const intervalIdRef = useRef<any>(null);
  // Job IDs awaiting a "flash" highlight once the next queue refresh lands
  // (used instead of a success Snackbar for Hold/Release, since the row is
  // still present afterward and can be highlighted directly).
  const pendingFlashJobIdsRef = useRef<string[] | null>(null);
  // Last-seen state (e.g. "R"/"PD"/"CD") per job ID, used to detect changes
  // for `notifyOnStateChange`. `null` means "not initialized yet" so we skip
  // notifying on the very first fetch (every job would otherwise appear to
  // have "changed" from nothing).
  const prevJobStatesRef = useRef<Record<string, string> | null>(null);
  // Debounce timer for persisting ag-grid column state (order/width/
  // visibility/pinning) to the settings registry; column drags/resizes fire
  // many events in quick succession, so we coalesce them into one write.
  const columnStateSaveTimerRef = useRef<any>(null);

  const jobIDLabel = useMemo(() => {
    return serverColumns.includes('JOBID')
      ? 'JOBID'
      : serverColumns.length > 0
        ? serverColumns[0]
        : 'JOBID';
  }, [serverColumns]);

  // Helper: re-apply grid filters
  //
  // This runs on data refreshes, resizes and remounts. It must be idempotent:
  // if the USER filter is already in the desired state we return early WITHOUT
  // calling setColumnFilterModel / onFilterChanged. Re-applying the model and
  // firing onFilterChanged unconditionally would disturb (reset/close) any
  // column-filter dropdown the user currently has open, making it impossible
  // to pick a value while auto-refresh is running.
  const reapplyGridFilters = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) {
      return;
    }
    // The grid may have been destroyed (e.g. remounted via gridKey, or unmounted
    // on tab switch) while a deferred call is still pending. Guard against
    // calling into a destroyed grid, which logs AG Grid error #26.
    if (typeof api.isDestroyed === 'function' && api.isDestroyed()) {
      return;
    }
    try {
      const desired = userOnly
        ? {
            filterType: 'text',
            type: 'equals',
            filter: props.userName
          }
        : null;
      const current = api.getColumnFilterModel
        ? api.getColumnFilterModel('USER')
        : undefined;
      // Only touch the grid when the USER filter actually needs to change.
      if (JSON.stringify(current ?? null) === JSON.stringify(desired)) {
        return;
      }
      api.setColumnFilterModel('USER', desired);
      if (api.onFilterChanged) {
        api.onFilterChanged();
      }
    } catch (e) {
      /* no-op */
    }
  }, [userOnly, props.userName]);

  // Re-apply grid filters whenever filterQuery or userOnly changes
  useEffect(() => {
    reapplyGridFilters();
  }, [reapplyGridFilters]);

  const sizeColumnsToFitSafe = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) {
      return;
    }
    if (typeof api.isDestroyed === 'function' && api.isDestroyed()) {
      return;
    }
    try {
      reapplyGridFilters();
      const sz = api.getGridSize ? api.getGridSize() : null;
      if (!sz || sz.width > 0) {
        api.sizeColumnsToFit();
      }
    } catch (e) {
      /* no-op */
    }
  }, [reapplyGridFilters]);

  // Fetch UI config
  useEffect(() => {
    (async () => {
      try {
        const resp = await requestAPI<any>('ui-config');
        if (resp && resp.success && resp.data) {
          const labels = resp.data.queue_column_labels || {};
          const sizing = resp.data.queue_column_sizing || {};
          setUiLabels(labels);
          setUiSizing(sizing);
          if (typeof resp.data.squeue_reload_limit_ms === 'number') {
            setReloadLimitMs(resp.data.squeue_reload_limit_ms);
          }
        }
      } catch (e) {
        console.warn('Failed to load /ui-config', e);
      }
    })();
  }, []);

  // Data fetching
  const getData = useCallback(
    async (rateLimit = 0) => {
      if (loading) {
        return;
      }
      if (rateLimit > 0) {
        const delta = Number(new Date()) - Number(lastSqueueFetch);
        if (delta < rateLimit) {
          return;
        }
      }

      setLoading(true);
      try {
        const data = await requestAPI<any>('squeue');
        const current = new Date();
        setLastSqueueFetch(current);
        setNextAvailableSqueueFetch(
          autoReload ? new Date(current.getTime() + reloadRate) : null
        );
        setLoading(false);
        const newRows = data?.data?.rows ?? [];
        const newCols = data?.data?.columns ?? [];
        setRows(newRows.slice());
        setServerColumns(newCols.slice());
        sizeColumnsToFitSafe();
      } catch (error) {
        console.error('Squeue fetch error', error);
        setLoading(false);
      }
    },
    [loading, lastSqueueFetch, autoReload, reloadRate, sizeColumnsToFitSafe]
  );

  // Re-apply grid filters after rows/columns update (e.g., after the queue tab
  // remounts and the first data load populates the USER column). Without this,
  // the "my jobs only" filter would only take effect on the next refresh.
  useEffect(() => {
    reapplyGridFilters();
  }, [displayRows, reapplyGridFilters]);

  useEffect(() => {
    // Only fetch while this tab is active. This keeps a hidden (but mounted)
    // queue from firing squeue in the background, and defers the initial load
    // until the tab is first shown.
    if (active && (reloadQueue || rows.length === 0)) {
      getData(reloadLimitMs).then(() => setReloadQueue(false));
    }
  }, [reloadQueue, reloadLimitMs, rows.length, getData, active]);

  // Polling logic
  useEffect(() => {
    // Poll only when auto-reload is on AND the tab is active. Pausing while
    // hidden avoids continuous background squeue load and keeps the rate limit
    // meaningful.
    if (autoReload && active) {
      setDisableManualRefresh(true);
      setNextAvailableSqueueFetch(new Date(new Date().getTime() + reloadRate));
      intervalIdRef.current = setInterval(() => {
        setReloadQueue(true);
      }, reloadRate);
    } else {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      setNextAvailableSqueueFetch(null);
      setReloadQueue(false);
      setDisableManualRefresh(!autoReload);
    }
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
    };
  }, [autoReload, reloadRate, active]);

  // Sync with display rows
  useEffect(() => {
    const updateRows = rows.map((x: string[]) => {
      const item: Record<string, unknown> = {};
      for (let col = serverColumns.length - 1; col >= 0; col--) {
        item[serverColumns[col]] = x[col];
      }
      return item;
    });
    setDisplayRows(updateRows);
  }, [rows, serverColumns]);

  // After a Hold/Release causes a queue refresh, flash the status cell of
  // the affected row(s) once the new data has actually landed in the grid,
  // instead of showing a success Snackbar (the row is still visible, so a
  // direct highlight is more useful feedback than a toast).
  useEffect(() => {
    const jobIds = pendingFlashJobIdsRef.current;
    const api = gridApiRef.current;
    if (!jobIds || !api) {
      return;
    }
    pendingFlashJobIdsRef.current = null;
    const statusField = serverColumns.includes('ST')
      ? 'ST'
      : serverColumns.includes('STATE')
        ? 'STATE'
        : null;
    // Defer to the next tick so AG Grid has applied the new rowData before
    // we look up row nodes by id.
    const id = setTimeout(() => {
      if (typeof api.isDestroyed === 'function' && api.isDestroyed()) {
        return;
      }
      try {
        const rowNodes = jobIds
          .map(jid => api.getRowNode(jid))
          .filter(Boolean);
        if (rowNodes.length === 0) {
          return;
        }
        api.flashCells({
          rowNodes,
          columns: statusField ? [statusField, jobIDLabel] : undefined
        });
      } catch (e) {
        /* no-op */
      }
    }, 0);
    return () => clearTimeout(id);
  }, [displayRows, serverColumns, jobIDLabel]);

  // Notify when a tracked job's state (ST/STATE column, e.g. "R" -> "CD")
  // changes, if the user has opted in via `notifyOnStateChange`. Compares
  // against the previous fetch's snapshot rather than the grid, since a job
  // that leaves the queue entirely (e.g. completes) is still worth reporting.
  useEffect(() => {
    const statusField = serverColumns.includes('ST')
      ? 'ST'
      : serverColumns.includes('STATE')
        ? 'STATE'
        : null;
    if (!statusField) {
      return;
    }
    const currentStates: Record<string, string> = {};
    for (const row of displayRows) {
      const jid = String(row[jobIDLabel]);
      currentStates[jid] = String(row[statusField]);
    }
    const prevStates = prevJobStatesRef.current;
    if (props.notifyOnStateChange && prevStates) {
      for (const [jid, state] of Object.entries(currentStates)) {
        const prev = prevStates[jid];
        if (prev !== undefined && prev !== state) {
          Notification.info(`Job ${jid} changed state: ${prev} \u2192 ${state}`, {
            autoClose: 6000
          });
        }
      }
    }
    prevJobStatesRef.current = currentStates;
  }, [displayRows, serverColumns, jobIDLabel, props.notifyOnStateChange]);

  // Persist ag-grid column state (order/width/visibility/pinning) so the
  // user's customized layout survives reloads. Debounced since drag/resize
  // interactions fire many intermediate events.
  const saveColumnState = useCallback(() => {
    const api = gridApiRef.current;
    if (!api || typeof api.getColumnState !== 'function') {
      return;
    }
    if (columnStateSaveTimerRef.current) {
      clearTimeout(columnStateSaveTimerRef.current);
    }
    columnStateSaveTimerRef.current = setTimeout(async () => {
      try {
        const state = api.getColumnState();
        const settings = await props.settingRegistry.load(PLUGIN_ID);
        await settings.set('columnState', state);
      } catch (e) {
        /* no-op */
      }
    }, 500);
  }, [props.settingRegistry]);

  // Settings persistence
  useEffect(() => {
    (async () => {
      try {
        const settings = await props.settingRegistry.load(PLUGIN_ID);
        if (settings.get('userOnly').composite !== userOnly) {
          await settings.set('userOnly', userOnly);
        }
        if (settings.get('autoReload').composite !== autoReload) {
          await settings.set('autoReload', autoReload);
        }
      } catch (e) {
        /* no-op */
      }
    })();
  }, [userOnly, autoReload, props.settingRegistry]);

  const onSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    if (gridApiRef.current) {
      setSelectedRows(gridApiRef.current.getSelectedRows());
    }
  }, []);

  const actionVerb: Record<JobAction, string> = {
    kill: 'Cancelled',
    hold: 'Held',
    release: 'Released'
  };

  const handleJobAction = useCallback(
    async (action: JobAction) => {
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

      const jobIDs = selectedRows.map(row => String(row[jobIDLabel]));
      try {
        const result = await requestAPI<any>(route, new URLSearchParams(), {
          body: JSON.stringify({ job_ids: jobIDs }),
          method,
          headers: { 'Content-Type': 'application/json' }
        });
        // The backend response envelope uses `success`/`exitCode` (see
        // SlurmCommandHandler.run_command and ScontrolHandler.patch); it does
        // not expose a `returncode` field. Treat either signal as success so the
        // queue reloads to reflect the new state (e.g. a held job's ST column).
        const succeeded = result?.success === true || result?.exitCode === 0;
        if (succeeded) {
          setReloadQueue(true);
          if (action === 'kill') {
            // A killed job disappears from the queue on the next refresh, so
            // there's no row left to highlight afterward — a confirmation
            // Snackbar is the only useful feedback here. Build our own
            // message rather than using the backend's `responseMessage`,
            // which embeds the full configured executable path (e.g.
            // "Success: /opt/slurm/bin/scancel 123") and isn't meant for
            // end-user display; also append a timestamp so the user can tell
            // when the action actually completed.
            const verb = actionVerb[action] ?? 'Updated';
            const jobWord = jobIDs.length === 1 ? 'job' : 'jobs';
            const timestamp = new Date().toLocaleTimeString();
            setSuccessMessage(
              `${verb} ${jobIDs.length} ${jobWord}: ${jobIDs.join(', ')} (${timestamp})`
            );
            setSuccessOpen(true);
            gridApiRef.current?.deselectAll();
            setSelectedRows([]);
          } else {
            // Hold/Release: the row is still present after the refresh, so
            // highlight its status cell directly instead of a toast.
            pendingFlashJobIdsRef.current = jobIDs;
          }
        } else {
          // Log only the error message, never the full result object (which
          // may include job data under `data`).
          console.error(
            `Action ${action} failed`,
            result?.errorMessage ?? result?.responseMessage
          );
          const timestamp = new Date().toLocaleTimeString();
          const jobList = jobIDs.length > 0 ? jobIDs.join(', ') : 'unknown';
          const detail = result?.errorMessage
            ? `: ${result.errorMessage}`
            : '';
          setErrorMessage(
            `Action ${action} failed for job(s) ${jobList}${detail} (${timestamp})`
          );
          setErrorOpen(true);
        }
      } catch (e) {
        console.error(`Action ${action} failed`, e);
        const timestamp = new Date().toLocaleTimeString();
        const jobList = jobIDs.length > 0 ? jobIDs.join(', ') : 'unknown';
        setErrorMessage(
          `Action ${action} failed for job(s) ${jobList} (${timestamp})`
        );
        setErrorOpen(true);
      }
    },
    [selectedRows, jobIDLabel]
  );

  const reload = () => setReloadQueue(true);

  return {
    rows,
    serverColumns,
    lastSqueueFetch,
    nextAvailableSqueueFetch,
    uiLabels,
    uiSizing,
    selectedRows,
    setSelectedRows,
    showSelectedOnly,
    setShowSelectedOnly,
    filterQuery,
    setFilterQuery,
    autoReload,
    setAutoReload,
    userOnly,
    setUserOnly,
    loading,
    displayRows,
    errorOpen,
    setErrorOpen,
    errorMessage,
    setErrorMessage,
    successOpen,
    setSuccessOpen,
    successMessage,
    gridApiRef,
    jobIDLabel,
    handleJobAction,
    reload,
    onSelectionChanged,
    reapplyGridFilters,
    sizeColumnsToFitSafe,
    disableManualRefresh,
    saveColumnState,
    initialColumnState: props.columnState
  };
}
