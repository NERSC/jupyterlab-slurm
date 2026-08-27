'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react';

import { Box, CircularProgress } from '@mui/material';
// Import from the package root (not a deep `lib/...` path) so webpack's
// module-federation sharing keys on `@jupyterlab/apputils` and reuses the
// same `Notification.manager` singleton the running JupyterLab shell's
// toast UI is subscribed to; a deep import bundles a private, disconnected
// copy that the shell never observes.
import { Notification } from '@jupyterlab/apputils';

import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ClientSideRowModelModule,
  ModuleRegistry,
  RowSelectionModule,
  RowSelectionOptions,
  ValidationModule,
  themeQuartz,
  colorSchemeDark
} from 'ag-grid-community';

// Local
import { COMMAND_ID_SHOW_DETAILS } from '../index';
import { useSlurmQueue } from '../hooks/useSlurmQueue';
import { ISlurmWidgetProps } from '../types';
import { SqueueToolbar } from './SqueueToolbar';
import { createDisplayColumnsFromServer } from '../utils/slurm-column-defs';
import { useJupyterThemeMode } from '../utils/theme';

// Register all Community features
ModuleRegistry.registerModules([
  AllCommunityModule,
  ClientSideRowModelModule,
  RowSelectionModule,
  ValidationModule
]);

export default function SqueueDataTable(props: ISlurmWidgetProps) {
  const {
    lastSqueueFetch,
    nextAvailableSqueueFetch,
    uiLabels,
    uiSizing,
    selectedRows,
    showSelectedOnly,
    setShowSelectedOnly,
    filterQuery,
    setFilterQuery,
    autoReload,
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
    initialColumnState
  } = useSlurmQueue(props);

  const themeMode = useJupyterThemeMode();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Surface action failures via JupyterLab's native toast notifications
  // (rather than an MUI Snackbar) so they match the rest of JupyterLab's UI.
  useEffect(() => {
    if (errorOpen && errorMessage) {
      Notification.error(errorMessage, { autoClose: 6000 });
      setErrorOpen(false);
    }
  }, [errorOpen, errorMessage, setErrorOpen]);

  // Kill/Cancel success is the one queue action whose row disappears from
  // the grid, so a toast is the only useful confirmation (Hold/Release
  // instead flash the still-visible row's status cell, see useSlurmQueue).
  useEffect(() => {
    if (successOpen && successMessage) {
      Notification.success(successMessage, { autoClose: 4000 });
      setSuccessOpen(false);
    }
  }, [successOpen, successMessage, setSuccessOpen]);

  // Live "now" ticker so the countdown to the next refresh stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!autoReload) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [autoReload]);

  const hasFetched =
    lastSqueueFetch.getTime() > new Date('1970-01-01').getTime();

  const lastUpdatedLabel = useMemo(() => {
    if (!hasFetched) {
      return '\u2014';
    }
    return `${lastSqueueFetch.toLocaleDateString()} ${lastSqueueFetch.toLocaleTimeString()}`;
  }, [hasFetched, lastSqueueFetch]);

  const secondsToNextRefresh = useMemo(() => {
    if (!autoReload || !nextAvailableSqueueFetch) {
      return null;
    }
    return Math.max(
      0,
      Math.ceil((nextAvailableSqueueFetch.getTime() - now) / 1000)
    );
  }, [autoReload, nextAvailableSqueueFetch, now]);

  // Remount key for AgGrid
  const gridKey = useMemo(() => {
    const opts = Array.isArray(props.itemsPerPageOptions)
      ? props.itemsPerPageOptions.join(',')
      : '';
    return `squeue-${props.itemsPerPageAuto}-${opts}`;
  }, [props.itemsPerPageAuto, props.itemsPerPageOptions]);

  const effectivePageSize = useMemo(() => {
    const options = props.itemsPerPageOptions || [];
    if (options.length === 0) {
      return props.itemsPerPage;
    }
    return options.includes(props.itemsPerPage)
      ? props.itemsPerPage
      : options[0];
  }, [props.itemsPerPage, props.itemsPerPageOptions]);

  // Re-fit columns when this tab becomes active. AG Grid measures width 0 while
  // the container is hidden (display:none), so column sizing computed while
  // inactive is a no-op; we re-run it once the tab is shown again.
  useEffect(() => {
    if (props.active === false) {
      return;
    }
    const id = setTimeout(() => {
      sizeColumnsToFitSafe();
      reapplyGridFilters();
    }, 50);
    return () => clearTimeout(id);
  }, [props.active, sizeColumnsToFitSafe, reapplyGridFilters]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const ro = new (window as any).ResizeObserver(() => {
      if (el.offsetWidth > 0) {
        sizeColumnsToFitSafe();
        reapplyGridFilters();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sizeColumnsToFitSafe, reapplyGridFilters]);

  // Build column defs
  const displayColumns = useMemo(() => {
    return createDisplayColumnsFromServer(
      Object.keys(displayRows[0] || {}),
      uiLabels,
      uiSizing
    );
  }, [displayRows, uiLabels, uiSizing]);

  // Handle "Show Details"
  const onShowDetails = useCallback(() => {
    const jobIds = selectedRows.map(r => String(r[jobIDLabel]));
    if (jobIds.length === 0) {
      return;
    }
    props.jupyterlabFrontend.commands
      .execute(COMMAND_ID_SHOW_DETAILS, { jobIds, index: 0 })
      .catch((e: unknown) => {
        setErrorMessage('Failed to open Job Details.');
        setErrorOpen(true);
      });
  }, [selectedRows, jobIDLabel, props.jupyterlabFrontend]);

  const effectiveRowData = useMemo(() => {
    if (!showSelectedOnly) {
      return displayRows;
    }
    const selectedIds = new Set(selectedRows.map(r => String(r[jobIDLabel])));
    return displayRows.filter(r => selectedIds.has(String(r[jobIDLabel])));
  }, [showSelectedOnly, displayRows, selectedRows, jobIDLabel]);

  const defaultColDef = {
    editable: false,
    flex: 1,
    filter: true,
    resizable: true,
    minWidth: 120,
    wrapHeaderText: true,
    autoHeaderHeight: true,
    wrapText: false,
    autoHeight: false
  };

  const rowSelection: RowSelectionOptions = {
    mode: 'multiRow',
    selectAll: 'filtered',
    checkboxes: true,
    headerCheckbox: true,
    enableClickSelection: true
  };

  return (
    <div className="jp-SlurmWidget-content">
      <SqueueToolbar
        filterQuery={filterQuery}
        setFilterQuery={setFilterQuery}
        autoReload={autoReload}
        onReloadClick={reload}
        disableManualRefresh={disableManualRefresh}
        selectedCount={selectedRows.length}
        onClearSelected={() => gridApiRef.current?.deselectAll()}
        onShowDetails={onShowDetails}
        onJobAction={handleJobAction}
        userOnly={userOnly}
        onUserOnlyClick={() => setUserOnly(!userOnly)}
        showSelectedOnly={showSelectedOnly}
        onShowSelectedOnlyClick={() => setShowSelectedOnly(!showSelectedOnly)}
      />

      <Box
        sx={{ paddingLeft: '15px', paddingRight: '15px', marginBottom: '8px' }}
      >
        <div className={'jp-SlurmWidget-status'}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Last updated: {lastUpdatedLabel}</span>
            {loading && <CircularProgress size={12} thickness={5} />}
          </Box>
          {loading ? (
            <div>Refreshing&hellip;</div>
          ) : (
            secondsToNextRefresh !== null && (
              <div>Next refresh in {secondsToNextRefresh}s</div>
            )
          )}
        </div>
      </Box>

      <div
        ref={containerRef}
        className="jp-SlurmWidget-table-container"
        style={{ flex: 1, minHeight: 0, width: '100%' }}
      >
        <AgGridReact
          key={gridKey}
          theme={
            themeMode === 'dark'
              ? themeQuartz.withPart(colorSchemeDark)
              : themeQuartz
          }
          rowData={effectiveRowData}
          columnDefs={displayColumns}
          defaultColDef={defaultColDef as any}
          rowSelection={rowSelection}
          onSelectionChanged={onSelectionChanged}
          quickFilterText={filterQuery || undefined}
          onGridReady={params => {
            gridApiRef.current = params.api;
            setTimeout(() => {
              if (
                typeof params.api.isDestroyed === 'function' &&
                params.api.isDestroyed()
              ) {
                return;
              }
              // Restore the user's persisted column order/width/visibility/
              // pinning, if any, before fitting/filtering.
              if (
                Array.isArray(initialColumnState) &&
                initialColumnState.length > 0 &&
                typeof params.api.applyColumnState === 'function'
              ) {
                try {
                  params.api.applyColumnState({
                    state: initialColumnState as any,
                    applyOrder: true
                  });
                } catch (e) {
                  /* no-op */
                }
              }
              reapplyGridFilters();
              params.api.sizeColumnsToFit();
            }, 50);
          }}
          onColumnMoved={saveColumnState}
          onColumnResized={saveColumnState}
          onColumnVisible={saveColumnState}
          onColumnPinned={saveColumnState}
          pagination={true}
          paginationAutoPageSize={props.itemsPerPageAuto}
          paginationPageSize={
            props.itemsPerPageAuto ? undefined : effectivePageSize
          }
          getRowId={params => params.data[jobIDLabel]}
          loading={loading && displayRows.length === 0}
        />
      </div>

    </div>
  );
}
