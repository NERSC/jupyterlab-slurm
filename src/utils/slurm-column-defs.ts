import { ITooltipParams } from 'ag-grid-community';
import { JOB_STATUS_CODES } from './slurm-status';
import { parseTimeInSeconds, parseJobID } from './slurm-parsing';

// NERSC/standard Slurm has no distinct held state code: a hold is a
// PENDING job (ST=PD) whose reason column reads one of several literal
// strings, confirmed directly against a real cluster:
//   - `(JobHeldUser)`  -- held via `scontrol hold`/`uhold` by the owner
//     or an account coordinator; user-releasable.
//   - `(JobHeldAdmin)` -- held by a privileged user; only an admin can
//     release it. This also happens as an automatic side effect of a
//     *plain* `scontrol requeue` (not `requeuehold`) on a job that was
//     SUSPENDED -- confirmed live.
//   - `(job requeued in held state)` -- the reason `scontrol requeuehold`
//     itself actually sets (on this Slurm version, for both a RUNNING and
//     a SUSPENDED job) -- this is a distinct literal, NOT `JobHeldUser`,
//     despite being a perfectly normal, user-releasable hold (confirmed
//     live: the owner's own `scontrol release` succeeds on it). Missing
//     this case was the actual root cause of "Requeue & Hold just shows
//     PENDING, not HOLD" -- the two `JobHeld*` reasons alone never
//     matched it.
// Detect all three so the queue surfaces "held" explicitly instead of an
// indistinguishable PENDING row.
export function isHeldReason(reason: unknown): boolean {
  return (
    typeof reason === 'string' &&
    /JobHeldUser|JobHeldAdmin|job.?requeued.?in.?held.?state/i.test(reason)
  );
}

// Distinguish which kind of hold applies, so the UI can tell the user
// whether they can release it themselves (JobHeldUser, and the
// requeuehold-specific "job requeued in held state" reason -- both
// confirmed user-releasable) or whether it requires an administrator
// (JobHeldAdmin).
export function isAdminHeldReason(reason: unknown): boolean {
  return typeof reason === 'string' && /JobHeldAdmin/i.test(reason);
}

// Translates a raw squeue ST/STATE code (e.g. "R", "PD") into the same
// human-readable text shown in the queue table, job details, and job
// history (e.g. "RUNNING", "PENDING (Held)") -- shared here so every
// place that needs to *display* a status code (including the queue
// column's own `displayName` below, and useSlurmQueue's state-change
// notifications) stays in sync with a single source of truth, rather
// than each re-implementing the JOB_STATUS_CODES lookup + Held-detection
// logic separately.
export function formatJobStatus(code: unknown, reason?: unknown): string {
  const key = String(code ?? '');
  const name = JOB_STATUS_CODES[key]?.name ?? key;
  if (key === 'PD' && isHeldReason(reason)) {
    return `${name} (Held)`;
  }
  return name;
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
      const displayName = (p: any) =>
        formatJobStatus(p?.value, p?.data?.['NODELIST(REASON)']);
      (col as any)['valueFormatter'] = displayName;
      // The text filter must match what the user actually sees (e.g.
      // "PENDING", "PENDING (Held)"), not the raw Slurm state code (e.g.
      // "PD") that only `valueFormatter` translates for display. Without
      // this, typing "PENDING" into the column filter returns zero rows
      // while typing the undocumented raw code "PD" works -- confusing,
      // since the UI never shows "PD" anywhere for the user to know to
      // type it. `filterValueGetter` runs the same formatting logic so
      // the filter operates on the displayed text instead.
      (col as any)['filterValueGetter'] = (p: any) =>
        displayName({ value: p?.data?.[id], data: p?.data });
      (col as any)['getQuickFilterText'] = (p: any) => {
        const code = p?.value ?? '';
        const name = JOB_STATUS_CODES[code]?.name ?? '';
        const held =
          code === 'PD' && isHeldReason(p?.data?.['NODELIST(REASON)'])
            ? 'Held JobHeldUser JobHeldAdmin'
            : '';
        return [code, name, held].filter(Boolean).join(' ');
      };
      col['tooltipValueGetter'] = (p: ITooltipParams) => {
        if (p.value && JOB_STATUS_CODES[p.value]) {
          const { name, description } = JOB_STATUS_CODES[p.value];
          const reason = (p as any)?.data?.['NODELIST(REASON)'];
          if (p.value === 'PD' && isHeldReason(reason)) {
            return isAdminHeldReason(reason)
              ? `${name} (Held by an administrator): ${description}`
              : `${name} (Held by user): ${description}`;
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
