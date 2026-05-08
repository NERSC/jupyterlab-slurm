'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react';

import {
  Snackbar,
  Alert
} from '@mui/material';

import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ClientSideRowModelModule,
  ModuleRegistry,
  RowSelectionModule,
  RowSelectionOptions,
  ValidationModule,
  themeQuartz
} from 'ag-grid-community';

// Local
import { PLUGIN_ID, COMMAND_ID_SHOW_DETAILS } from '../index';
import { useSlurmQueue, SlurmQueueProps } from '../hooks/useSlurmQueue';
import { SqueueToolbar } from './SqueueToolbar';
import { createDisplayColumnsFromServer } from '../utils/slurm-column-defs';

// Register all Community features
ModuleRegistry.registerModules([
  AllCommunityModule,
  ClientSideRowModelModule,
  RowSelectionModule,
  ValidationModule
]);

export default function SqueueDataTable(props: SlurmQueueProps) {
  const {
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
    gridApiRef,
    jobIDLabel,
    handleJobAction,
    reload,
    onSelectionChanged,
    reapplyGridFilters,
    sizeColumnsToFitSafe,
    disableManualRefresh
  } = useSlurmQueue(props);

  const [theme, setTheme] = useState('default');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Remount key for AgGrid
  const gridKey = useMemo(() => {
    const opts = Array.isArray(props.itemsPerPageOptions)
      ? props.itemsPerPageOptions.join(',')
      : '';
    return `squeue-${props.itemsPerPageAuto}-${opts}`;
  }, [props.itemsPerPageAuto, props.itemsPerPageOptions]);

  const effectivePageSize = useMemo(() => {
    const options = props.itemsPerPageOptions || [];
    if (options.length === 0) return props.itemsPerPage;
    return options.includes(props.itemsPerPage) ? props.itemsPerPage : options[0];
  }, [props.itemsPerPage, props.itemsPerPageOptions]);

  // Theme observer
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isLight = document.body.getAttribute('data-jp-theme-light') === 'true';
      setTheme(isLight ? 'default' : 'dark');
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-jp-theme-light'] });
    return () => observer.disconnect();
  }, []);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
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
    return createDisplayColumnsFromServer(Object.keys(displayRows[0] || {}), uiLabels, uiSizing);
  }, [displayRows, uiLabels, uiSizing]);

  // Handle "Show Details"
  const onShowDetails = useCallback(() => {
    const jobIds = selectedRows.map(r => String(r[jobIDLabel]));
    if (jobIds.length === 0) return;
    props.jupyterlabFrontend.commands.execute(COMMAND_ID_SHOW_DETAILS, { jobIds, index: 0 })
      .catch(e => {
        setErrorMessage('Failed to open Job Details.');
        setErrorOpen(true);
      });
  }, [selectedRows, jobIDLabel, props.jupyterlabFrontend]);

  const effectiveRowData = useMemo(() => {
    if (!showSelectedOnly) return displayRows;
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

      <div
        ref={containerRef}
        className="jp-SlurmWidget-table-container"
        style={{ flex: 1, minHeight: 0, width: '100%' }}
      >
        <AgGridReact
          key={gridKey}
          theme={theme === 'dark' ? themeQuartz.withPart('dark') : themeQuartz}
          rowData={effectiveRowData}
          columnDefs={displayColumns}
          defaultColDef={defaultColDef as any}
          rowSelection={rowSelection}
          onSelectionChanged={onSelectionChanged}
          onGridReady={params => {
            gridApiRef.current = params.api;
            setTimeout(() => {
              reapplyGridFilters();
              params.api.sizeColumnsToFit();
            }, 50);
          }}
          pagination={true}
          paginationAutoPageSize={props.itemsPerPageAuto}
          paginationPageSize={props.itemsPerPageAuto ? undefined : effectivePageSize}
          getRowId={params => params.data[jobIDLabel]}
          loading={loading}
        />
      </div>

      <Snackbar
        open={errorOpen}
        autoHideDuration={6000}
        onClose={() => setErrorOpen(false)}
      >
        <Alert severity="error" onClose={() => setErrorOpen(false)}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </div>
  );
}
