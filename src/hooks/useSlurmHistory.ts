import { useCallback, useEffect, useState } from 'react';
import { SacctResponse } from '../types';
import { requestAPI } from '../handler';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import bundledUi from '../../jupyter-config/jupyter_server_config.d/jupyterlab-slurm-ui.json';

function toRowObjects(columns: string[], rows: string[][]): any[] {
  return rows.map(r => {
    const obj: Record<string, string> = {};
    columns.forEach((c, i) => {
      obj[c] = (r[i] ?? '').toString();
    });
    return obj;
  });
}

export function useSlurmHistory(userName: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [historyLabels, setHistoryLabels] = useState<Record<string, string>>(
    {}
  );

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (userName && userName.trim().length > 0) {
        params.set('user', userName.trim());
      }
      const resp = await requestAPI<SacctResponse>('sacct', params);
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
  }, [userName]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await requestAPI<any>('ui-config');
        const serverLabels =
          (resp && resp.data && resp.data.history_column_labels) || {};
        const bundled =
          (bundledUi &&
            (bundledUi as any).SlurmUI &&
            (bundledUi as any).SlurmUI.history_column_labels) ||
          {};
        const effective = { ...bundled, ...serverLabels };
        if (!cancelled) {
          setHistoryLabels(effective);
        }
      } catch (e) {
        const bundled =
          (bundledUi &&
            (bundledUi as any).SlurmUI &&
            (bundledUi as any).SlurmUI.history_column_labels) ||
          {};
        if (!cancelled) {
          console.warn(
            'Failed to load /ui-config; using bundled history labels',
            e
          );
          setHistoryLabels(bundled);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    loading,
    error,
    columns,
    rows,
    historyLabels,
    fetchHistory
  };
}
