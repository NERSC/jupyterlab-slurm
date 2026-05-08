'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge, Button, CircularProgress, Stack, Typography, Snackbar, Alert } from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';

import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ColDef, ITooltipParams, ModuleRegistry, themeQuartz } from 'ag-grid-community';

// Register Community features we need
ModuleRegistry.registerModules([AllCommunityModule]);

import { JupyterFrontEnd } from '@jupyterlab/application';
import { requestAPI } from '../handler';
// Bundled deployment UI defaults (labels). These are merged with
// server-provided values from /ui-config, where server values take precedence.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - allow JSON import without explicit typings
import bundledUi from '../../jupyter-config/jupyter_server_config.d/jupyterlab-slurm-ui.json';

namespace types {
  export type Props = {
    userName: string;
    jupyterLabFrontend: JupyterFrontEnd; // reserved for future enhancements
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
}

function toRowObjects(columns: string[], rows: string[][]): any[] {
  return rows.map(r => {
    const obj: Record<string, string> = {};
    columns.forEach((c, i) => {
      obj[c] = (r[i] ?? '').toString();
    });
    return obj;
  });
}

export default function SlurmJobHistory(props: types.Props) {
  const gridRef = useRef<AgGridReact<any>>(null);
  const gridApiRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [historyLabels, setHistoryLabels] = useState<Record<string, string>>({});
  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pass the current user to the server so it can filter results
      const params = new URLSearchParams();
      if (props.userName && props.userName.trim().length > 0) {
        params.set('user', props.userName.trim());
      }
      const resp = await requestAPI<types.SacctResponse>('sacct', params);
      if (!resp.success) {
        throw new Error(resp.errorMessage || 'Unknown error fetching sacct');
      }
      const cols = resp.data.columns || [];
      const data = toRowObjects(cols, resp.data.rows || []);
      setColumns(cols);
      setRows(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setColumns([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [props.userName]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  // Load deployment-specific UI config for history labels, merging bundled defaults
  // so that labels are applied even if the server isn't configured with SlurmUI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await requestAPI<any>('ui-config');
        const serverLabels = (resp && resp.data && resp.data.history_column_labels) || {};
        const bundled = (bundledUi && (bundledUi as any).SlurmUI && (bundledUi as any).SlurmUI.history_column_labels) || {};
        const effective = { ...bundled, ...serverLabels };
        if (!cancelled) {
          setHistoryLabels(effective);
        }
      } catch (e) {
        // Fallback to bundled defaults only
        const bundled = (bundledUi && (bundledUi as any).SlurmUI && (bundledUi as any).SlurmUI.history_column_labels) || {};
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn('Failed to load /ui-config; using bundled history labels', e);
          setHistoryLabels(bundled);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sizeColumnsToFitSafe = useCallback(() => {
    if (!gridApiRef.current) {
      return;
    }
    try {
      const sz = gridApiRef.current.getGridSize ? gridApiRef.current.getGridSize() : null;
      if (!sz || (sz && sz.width > 0)) {
        gridApiRef.current.sizeColumnsToFit();
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const onGridReady = useCallback((params: any) => {
    gridApiRef.current = params.api;
    // Fit columns when grid is initialized and visible
    try {
      const sz = params.api.getGridSize ? params.api.getGridSize() : null;
      if (!sz || (sz && sz.width > 0)) {
        params.api.sizeColumnsToFit();
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const getSelectedJobIdsInDisplayOrder = useCallback((): string[] => {
    const api = gridApiRef.current;
    if (!api) return [];
    const ids: string[] = [];
    const count = api.getDisplayedRowCount ? api.getDisplayedRowCount() : 0;
    for (let i = 0; i < count; i++) {
      const row = api.getDisplayedRowAtIndex(i);
      if (row && row.isSelected && row.isSelected()) {
        const data = row.data || {};
        const id = (data['JobID'] ?? data['JOBID'] ?? '').toString();
        if (id) ids.push(id);
      }
    }
    return ids;
  }, []);

  const onSelectionChanged = useCallback(() => {
    const ids = getSelectedJobIdsInDisplayOrder();
    setSelectedCount(ids.length);
  }, [getSelectedJobIdsInDisplayOrder]);

  const columnDefs = useMemo<ColDef[]>(() => {
    return columns.map((c, idx) => {
      const col: ColDef = {
        field: c,
        headerName: historyLabels[c] ?? c,
        sortable: true,
        resizable: true,
        filter: true,
        // Show full cell content on hover
        tooltipValueGetter: (p: ITooltipParams) => `${p.value ?? ''}`
      };
      // Add checkbox selection on the first column for consistency with Queue tab
      if (idx === 0) {
        (col as any).headerCheckboxSelection = true;
        (col as any).checkboxSelection = true;
      }
      return col;
    });
  }, [columns, historyLabels]);

  // Use AG Grid v33+ React theming API by passing the theme object via the `theme` prop on AgGridReact
  const gridTheme = useMemo(() => themeQuartz.withParams({ headerHeight: 34, rowHeight: 30 }), []);

  // Default column behavior: keep header wrap, disable row auto-wrap/auto-height
  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    // Encourage columns to share available width
    flex: 1,
    minWidth: 120,
    // Wrapping for long headers and dynamic header height
    wrapHeaderText: true as any,
    autoHeaderHeight: true as any,
    // Row data: do not auto-wrap or auto-grow rows; rely on tooltips/hover
    wrapText: false as any,
    autoHeight: false as any
  }), []);

  // Observe container size and fit columns when it becomes visible or resizes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    let rafId: number | null = null;
    let lastWidth = 0;
    const ro = new (window as any).ResizeObserver(() => {
      const w = el.offsetWidth || 0;
      if (w > 0 && w !== lastWidth) {
        lastWidth = w;
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
          sizeColumnsToFitSafe();
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
  }, [sizeColumnsToFitSafe]);

  return (
    <div className="jp-SlurmWidget-content">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="h6" component="div" sx={{ flex: 1, ml: 1 }}>
          Job History{props.userName ? ` for ${props.userName}` : ''}
        </Typography>
        <Button
          onClick={fetchHistory}
          variant="outlined"
          size="small"
          startIcon={<ReplayIcon fontSize="small" />}
          aria-label="Refresh job history"
        >
          Refresh
        </Button>
        <Button
          onClick={() => {
            const ids = getSelectedJobIdsInDisplayOrder();
            if (!ids.length) return;
            try {
              // Call the command by id directly to avoid import-time cycles
              const result = props.jupyterLabFrontend.commands.execute(
                'jupyterlab-slurm:show-job-details',
                { jobIds: ids, index: 0 }
              );
              // If the command returns a promise, catch rejections to surface errors to the user
              if (result && typeof (result as any).then === 'function') {
                (result as Promise<any>).catch(e => {
                  // eslint-disable-next-line no-console
                  console.error('Failed to open Job Details from history', e);
                  setErrorMessage('Failed to open Job Details. You may not have permission to view one or more selected jobs.');
                  setErrorOpen(true);
                });
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error('Failed to open Job Details from history', e);
              setErrorMessage('Failed to open Job Details. You may not have permission to view one or more selected jobs.');
              setErrorOpen(true);
            }
          }}
          variant="contained"
          size="small"
          disabled={selectedCount === 0}
        >
          Show details
          {selectedCount > 0 && (
            <Badge className={'jp-SlurmWidget-table-button-badge'} badgeContent={selectedCount} color={'secondary'} />
          )}
        </Button>
      </Stack>

      {loading && (
        <Stack alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 160 }}>
          <CircularProgress size={24} />
        </Stack>
      )}

      {!loading && error && (
        <Stack spacing={1} sx={{ p: 2 }}>
          <Typography color="error">{error}</Typography>
          <Button onClick={fetchHistory} variant="contained" size="small">
            Try again
          </Button>
        </Stack>
      )}

      {!loading && !error && (
        <div className={'jp-SlurmWidget-table'} ref={containerRef}>
          <AgGridReact
            ref={gridRef}
            columnDefs={columnDefs}
            rowData={rows}
            defaultColDef={defaultColDef}
            theme={gridTheme}
            // Fit columns to avoid horizontal scrolling
            onGridReady={onGridReady}
            onFirstDataRendered={sizeColumnsToFitSafe}
            onGridSizeChanged={sizeColumnsToFitSafe}
            rowSelection={'multiple' as any}
            rowMultiSelectWithClick={true}
            suppressRowClickSelection={false}
            onSelectionChanged={onSelectionChanged as any}
          />
        </div>
      )}

      {/* Error Snackbar for failures opening Job Details from History */}
      <Snackbar
        open={errorOpen}
        autoHideDuration={6000}
        onClose={() => setErrorOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setErrorOpen(false)} severity="error" sx={{ width: '100%' }}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </div>
  );
}
