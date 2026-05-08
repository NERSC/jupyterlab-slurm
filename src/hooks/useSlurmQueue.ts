import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { requestAPI } from '../handler';
import { JobAction } from '../types';
import { PLUGIN_ID } from '../index';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { SelectionChangedEvent } from 'ag-grid-community';

// Local types
export type SlurmQueueProps = {
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

export function useSlurmQueue(props: SlurmQueueProps) {
  const [rows, setRows] = useState<string[][]>([]);
  const [serverColumns, setServerColumns] = useState<string[]>([]);
  const [uiLabels, setUiLabels] = useState<Record<string, string>>({});
  const [uiSizing, setUiSizing] = useState<Record<string, any>>({});
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [clearSelected, setClearSelected] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [lastSqueueFetch, setLastSqueueFetch] = useState(new Date('1970-01-01'));
  const [nextAvailableSqueueFetch, setNextAvailableSqueueFetch] = useState<Date | null>(null);
  const [autoReload, setAutoReload] = useState<boolean>(props.autoReload);
  const [reloadRate, setReloadRate] = useState(props.reloadRate * 1000);
  const [reloadQueue, setReloadQueue] = useState(false);
  const [disableManualRefresh, setDisableManualRefresh] = useState(!props.autoReload);
  const [reloadLimitMs, setReloadLimitMs] = useState<number>(5000);
  const [userOnly, setUserOnly] = useState(props.userOnly);
  const [loading, setLoading] = useState(false);
  const [displayRows, setDisplayRows] = useState<Record<string, unknown>[]>([]);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const gridApiRef = useRef<any>(null);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);

  const jobIDLabel = useMemo(() => {
    return serverColumns.includes('JOBID')
      ? 'JOBID'
      : serverColumns.length > 0
        ? serverColumns[0]
        : 'JOBID';
  }, [serverColumns]);

  // Helper: re-apply grid filters
  const reapplyGridFilters = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    try {
      if (userOnly) {
        api.setColumnFilterModel('USER', {
          filterType: 'text',
          type: 'equals',
          filter: props.userName
        });
      } else {
        api.setColumnFilterModel('USER', null);
      }
      api.setQuickFilter(filterQuery || null);
      if (api.onFilterChanged) {
        api.onFilterChanged();
      }
    } catch (e) { /* no-op */ }
  }, [userOnly, props.userName, filterQuery]);

  const sizeColumnsToFitSafe = useCallback(() => {
    if (!gridApiRef.current) return;
    try {
      reapplyGridFilters();
      const sz = gridApiRef.current.getGridSize ? gridApiRef.current.getGridSize() : null;
      if (!sz || sz.width > 0) {
        gridApiRef.current.sizeColumnsToFit();
      }
    } catch (e) { /* no-op */ }
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
  const getData = useCallback(async (rateLimit = 0) => {
    if (loading) return;
    if (rateLimit > 0) {
      const delta = Number(new Date()) - Number(lastSqueueFetch);
      if (delta < rateLimit) return;
    }

    setLoading(true);
    try {
      const data = await requestAPI<any>('squeue');
      const current = new Date();
      setLastSqueueFetch(current);
      setLoading(false);
      const newRows = data?.data?.rows ?? [];
      const newCols = data?.data?.columns ?? [];
      setRows(newRows.slice());
      setServerColumns(newCols.slice());
      sizeColumnsToFitSafe();
      if (autoReload) {
        setNextAvailableSqueueFetch(new Date(current.getTime() + reloadRate));
      } else {
        setNextAvailableSqueueFetch(null);
      }
    } catch (error) {
      console.error('Squeue fetch error', error);
      setLoading(false);
    }
  }, [loading, lastSqueueFetch, autoReload, reloadRate, sizeColumnsToFitSafe]);

  useEffect(() => {
    if (reloadQueue || rows.length === 0) {
      getData(reloadLimitMs).then(() => setReloadQueue(false));
    }
  }, [reloadQueue, reloadLimitMs, rows.length, getData]);

  // Polling logic
  useEffect(() => {
    if (autoReload) {
      setDisableManualRefresh(true);
      if (intervalIdRef.current === null) {
        setNextAvailableSqueueFetch(new Date(Date.now() + reloadRate));
      }
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
      setDisableManualRefresh(false);
    }
    return () => {
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    };
  }, [autoReload, reloadRate]);

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

  // Settings persistence
  useEffect(() => {
    (async () => {
      try {
        const settings = await props.settingRegistry.load(PLUGIN_ID);
        if (settings.get('userOnly').composite !== userOnly) await settings.set('userOnly', userOnly);
        if (settings.get('autoReload').composite !== autoReload) await settings.set('autoReload', autoReload);
      } catch (e) { /* no-op */ }
    })();
  }, [userOnly, autoReload, props.settingRegistry]);

  const onSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    if (gridApiRef.current) {
      setSelectedRows(gridApiRef.current.getSelectedRows());
    }
  }, []);

  const handleJobAction = useCallback(async (action: JobAction) => {
    const { route, method } = (action => {
      switch (action) {
        case 'kill': return { route: 'scancel', method: 'DELETE' };
        case 'hold': return { route: 'scontrol/hold', method: 'PATCH' };
        case 'release': return { route: 'scontrol/release', method: 'PATCH' };
      }
    })(action);

    const jobIDs = selectedRows.map(row => String(row[jobIDLabel]));
    try {
      const result = await requestAPI<any>(route, new URLSearchParams(), {
        body: JSON.stringify({ job_ids: jobIDs }),
        method,
        headers: { 'Content-Type': 'application/json' }
      });
      if (result.returncode === 0) {
        setReloadQueue(true);
        if (action === 'kill') {
          gridApiRef.current?.deselectAll();
          setSelectedRows([]);
        }
      }
    } catch (e) {
      console.error(`Action ${action} failed`, e);
    }
  }, [selectedRows, jobIDLabel]);

  const reload = () => setReloadQueue(true);

  return {
    rows,
    serverColumns,
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
    gridApiRef,
    jobIDLabel,
    handleJobAction,
    reload,
    onSelectionChanged,
    reapplyGridFilters,
    sizeColumnsToFitSafe,
    disableManualRefresh
  };
}
