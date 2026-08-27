import { ITooltipParams } from 'ag-grid-community';
import { JOB_STATUS_CODES } from './slurm-status';
import { parseTimeInSeconds, parseJobID } from './slurm-parsing';

// NERSC/standard Slurm has no distinct held state code: a user hold is a
// PENDING job (ST=PD) whose reason column reads `(JobHeldUser)`. Detect that so
// the queue can surface "held" explicitly instead of an indistinguishable
// PENDING row.
export function isHeldReason(reason: unknown): boolean {
  return typeof reason === 'string' && /JobHeldUser/i.test(reason);
}

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
      col['comparator'] = (valueA: any, valueB: any) =>
        Number(valueA) - Number(valueB);
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
        const name = JOB_STATUS_CODES[code]?.name ?? code;
        // A PENDING job held by the user (Reason=(JobHeldUser)) is surfaced as
        // "PENDING (Held)" so it is distinguishable from a normal pending job.
        if (code === 'PD' && isHeldReason(p?.data?.['NODELIST(REASON)'])) {
          return `${name} (Held)`;
        }
        return name;
      };
      (col as any)['getQuickFilterText'] = (p: any) => {
        const code = p?.value ?? '';
        const name = JOB_STATUS_CODES[code]?.name ?? '';
        const held =
          code === 'PD' && isHeldReason(p?.data?.['NODELIST(REASON)'])
            ? 'Held JobHeldUser'
            : '';
        return [code, name, held].filter(Boolean).join(' ');
      };
      col['tooltipValueGetter'] = (p: ITooltipParams) => {
        if (p.value && JOB_STATUS_CODES[p.value]) {
          const { name, description } = JOB_STATUS_CODES[p.value];
          if (
            p.value === 'PD' &&
            isHeldReason((p as any)?.data?.['NODELIST(REASON)'])
          ) {
            return `${name} (Held by user): ${description}`;
          }
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
