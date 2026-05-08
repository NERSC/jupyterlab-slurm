import { ITooltipParams } from 'ag-grid-community';
import { JOB_STATUS_CODES } from './slurm-status';
import { parseTimeInSeconds, parseJobID } from './slurm-parsing';

export function createDisplayColumnsFromServer(
  ids: string[],
  uiLabels: Record<string, string>,
  uiSizing: Record<string, any>
) {
  if (!ids || ids.length === 0) {
    return [] as any[];
  }
  return ids.map(id => {
    const col: Record<string, unknown> = {
      field: id,
      headerName: uiLabels[id] ?? id
    };

    if (id === 'NODES') {
      col['filter'] = 'agNumberColumnFilter';
      col['comparator'] = (valueA: any, valueB: any) => Number(valueA) - Number(valueB);
    } else if (id === 'TIME') {
      col['comparator'] = (valueA: any, valueB: any) =>
        parseTimeInSeconds(valueA) - parseTimeInSeconds(valueB);
    } else if (id === 'JOBID') {
      col['comparator'] = (valueA: any, valueB: any) =>
        parseJobID(valueA) - parseJobID(valueB);
    }

    if ((id === 'ST' || id === 'STATE') && !uiLabels[id]) {
      col['headerName'] = 'Job Status';
    }

    if (id === 'ST' || id === 'STATE') {
      col['filter'] = 'agTextColumnFilter';
      col['floatingFilter'] = false;
      (col as any)['valueFormatter'] = (p: any) => {
        const code = p?.value ?? '';
        return JOB_STATUS_CODES[code]?.name ?? code;
      };
      (col as any)['getQuickFilterText'] = (p: any) => {
        const code = p?.value ?? '';
        const name = JOB_STATUS_CODES[code]?.name ?? '';
        return [code, name].filter(Boolean).join(' ');
      };
      col['tooltipValueGetter'] = (p: ITooltipParams) => {
        if (p.value && JOB_STATUS_CODES[p.value]) {
          const { name, description } = JOB_STATUS_CODES[p.value];
          return `${name}: ${description}`;
        }
        return '';
      };
    } else {
      col['tooltipValueGetter'] = (p: ITooltipParams) => `${p.value ?? ''}`;
    }

    const sizing = uiSizing[id];
    if (sizing && typeof sizing === 'object') {
      Object.assign(col, sizing);
    }

    return col;
  });
}
