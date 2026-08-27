'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import {
  Badge,
  Button,
  CircularProgress,
  Stack,
  Typography,
  Snackbar,
  Alert
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ReplayIcon from '@mui/icons-material/Replay';

import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ColDef,
  ITooltipParams,
  ModuleRegistry,
  themeQuartz,
  colorSchemeDark
} from 'ag-grid-community';

// Register Community features we need
ModuleRegistry.registerModules([AllCommunityModule]);

import { JupyterFrontEnd } from '@jupyterlab/application';
import { useSlurmHistory } from '../hooks/useSlurmHistory';
import { useJupyterThemeMode } from '../utils/theme';

namespace types {
  export type Props = {
    userName: string;
    jupyterLabFrontend: JupyterFrontEnd;
    // Whether this tab is currently visible/active. History is refetched when
    // it becomes active so a kept-mounted tab shows fresh data on each visit.
    active?: boolean;
  };
}

export default function SlurmJobHistory(props: types.Props) {
  const gridApiRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { loading, error, columns, rows, historyLabels, fetchHistory } =
    useSlurmHistory(props.userName);

  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const copyToClipboard = useCallback(async (text: string, format: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(`${format} copied to clipboard`);
    } catch (e) {
      console.warn('Failed to copy', e);
      setCopySuccess('Failed to copy to clipboard');
    }
  }, []);

  const copyMarkdownToClipboard = useCallback(() => {
    if (!rows.length) {
      return;
    }
    const labels = historyLabels;
    const cols = columns;
    const headerRow = cols.map(c => labels[c] ?? c);
    let md = '### Slurm Job History\n\n';
    md += '| ' + headerRow.join(' | ') + ' |\n';
    md += '| ' + headerRow.map(() => ':---').join(' | ') + ' |\n';
    for (const row of rows) {
      const vals = cols.map(c => (row[c] ?? '').toString());
      md += '| ' + vals.join(' | ') + ' |\n';
    }
    copyToClipboard(md, 'Markdown');
  }, [rows, columns, historyLabels, copyToClipboard]);

  const copyJsonToClipboard = useCallback(() => {
    if (!rows.length) {
      return;
    }
    const labels = historyLabels;
    const labeled = rows.map(row => {
      const obj: Record<string, string> = {};
      for (const c of columns) {
        obj[labels[c] ?? c] = (row[c] ?? '').toString();
      }
      return obj;
    });
    copyToClipboard(JSON.stringify(labeled, null, 2), 'JSON');
  }, [rows, columns, historyLabels, copyToClipboard]);

  const sizeColumnsToFitSafe = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) {
      return;
    }
    if (typeof api.isDestroyed === 'function' && api.isDestroyed()) {
      return;
    }
    try {
      const sz = api.getGridSize ? api.getGridSize() : null;
      if (!sz || (sz && sz.width > 0)) {
        api.sizeColumnsToFit();
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const onGridReady = useCallback((params: any) => {
    gridApiRef.current = params.api;
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
    if (!api) {
      return [];
    }
    const ids: string[] = [];
    const count = api.getDisplayedRowCount ? api.getDisplayedRowCount() : 0;
    for (let i = 0; i < count; i++) {
      const row = api.getDisplayedRowAtIndex(i);
      if (row && row.isSelected && row.isSelected()) {
        const data = row.data || {};
        const id = (data['JobID'] ?? data['JOBID'] ?? '').toString();
        if (id) {
          ids.push(id);
        }
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
        tooltipValueGetter: (p: ITooltipParams) => `${p.value ?? ''}`
      };
      if (idx === 0) {
        (col as any).headerCheckboxSelection = true;
        (col as any).checkboxSelection = true;
      }
      return col;
    });
  }, [columns, historyLabels]);

  const themeMode = useJupyterThemeMode();
  const gridTheme = useMemo(() => {
    const base = themeQuartz.withParams({ headerHeight: 34, rowHeight: 30 });
    return themeMode === 'dark' ? base.withPart(colorSchemeDark) : base;
  }, [themeMode]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
      filter: true,
      flex: 1,
      minWidth: 120,
      wrapHeaderText: true as any,
      autoHeaderHeight: true as any,
      wrapText: false as any,
      autoHeight: false as any
    }),
    []
  );

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

  // Refetch history when the tab transitions from hidden -> active. The hook
  // already fetches once on mount, so we skip the very first activation to
  // avoid a duplicate initial request.
  const wasActiveRef = useRef<boolean>(props.active !== false);
  useEffect(() => {
    const isActive = props.active !== false;
    if (isActive && !wasActiveRef.current) {
      void fetchHistory();
      // Re-fit columns once shown; AG Grid measures width 0 while hidden.
      const id = setTimeout(() => sizeColumnsToFitSafe(), 50);
      wasActiveRef.current = isActive;
      return () => clearTimeout(id);
    }
    wasActiveRef.current = isActive;
  }, [props.active, fetchHistory, sizeColumnsToFitSafe]);

  return (
    <div className="jp-SlurmWidget-content">
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ mb: 1, mx: 1 }}
      >
        <Typography variant="h6" component="div" sx={{ flex: 1, ml: 1 }}>
          Job History{props.userName ? ` for ${props.userName}` : ''}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 'bold' }}
          >
            Copy to Clipboard:
          </Typography>
          <Button
            size="small"
            startIcon={<ContentCopyIcon fontSize="inherit" />}
            onClick={copyMarkdownToClipboard}
            disabled={!rows.length}
            sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0 }}
          >
            Markdown
          </Button>
          <Button
            size="small"
            startIcon={<ContentCopyIcon fontSize="inherit" />}
            onClick={copyJsonToClipboard}
            disabled={!rows.length}
            sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0 }}
          >
            JSON
          </Button>
        </Stack>
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
            if (!ids.length) {
              return;
            }
            try {
              const result = props.jupyterLabFrontend.commands.execute(
                'jupyterlab-slurm:show-job-details',
                { jobIds: ids, index: 0 }
              );
              if (result && typeof (result as any).then === 'function') {
                (result as Promise<any>).catch(e => {
                  console.error('Failed to open Job Details from history', e);
                  setErrorMessage(
                    'Failed to open Job Details. You may not have permission to view one or more selected jobs.'
                  );
                  setErrorOpen(true);
                });
              }
            } catch (e) {
              console.error('Failed to open Job Details from history', e);
              setErrorMessage(
                'Failed to open Job Details. You may not have permission to view one or more selected jobs.'
              );
              setErrorOpen(true);
            }
          }}
          variant="contained"
          size="small"
          disabled={selectedCount === 0}
        >
          Show details
          {selectedCount > 0 && (
            <Badge
              className={'jp-SlurmWidget-table-button-badge'}
              badgeContent={selectedCount}
              color={'secondary'}
            />
          )}
        </Button>
      </Stack>

      {loading && (
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{ flex: 1, minHeight: 160 }}
        >
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
            columnDefs={columnDefs}
            rowData={rows}
            defaultColDef={defaultColDef}
            theme={gridTheme}
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

      <Snackbar
        open={!!copySuccess}
        autoHideDuration={3000}
        onClose={() => setCopySuccess(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setCopySuccess(null)}
          severity="success"
          sx={{ width: '100%' }}
        >
          {copySuccess}
        </Alert>
      </Snackbar>
    </div>
  );
}
