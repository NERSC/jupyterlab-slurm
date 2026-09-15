(usage)=

# Usage

Proper usage of this extension requires prerequisite knowledge of using the Slurm Workload Manager, and writing batch scripts for job submission. For more information please visit the [Slurm Documentation](https://slurm.schedmd.com/) page, or seek further instruction through your institution's resources.

## Getting Started

After installing the extension and launching JupyterLab, the extension can be found in the command palette under the name **Slurm Dashboard**, and is listed under the **HPC TOOLS** section of the palette and the JupyterLab launcher. Open the extension through either of these two access points.

```{only} html
![Launching the extension](../animations/getting_started.gif)
```

## User view vs. global view

By default, the extension will be launched in "user view", meaning only jobs registered under your username in the system will be displayed in the queue. If you wish to view the entire queue, click the toggle labelled "Show my jobs only", and the queue will be switched to "global view". Note that the underlying Slurm command for retrieving queue data, `squeue`, is much more responsive for a smaller subset of jobs rather than the entire queue, so user view should be preferred unless you need to view other's jobs.

```{only} html
![View switch and searching](../animations/view_and_search.gif)
```

```{note}
Every field of the queue table is searchable via the **Search** entry box on the top right of the extension's GUI. You can sort the table based off any column as well. This means it is very simple to show only your active jobs, held jobs, etc.
```

## Viewing job details

Select a single job row and click **Details** to open a separate panel
with the full, normalized set of fields for that job (submit/start/end
time, resources, working directory, stdout/stderr paths with
file-existence info, etc.), sourced from `scontrol`/`sacct` on the
backend. **Details** is disabled for a *grouped* range of still-pending
array tasks (e.g. `1234_[3-20%4]`, squeue's display form for array
elements sharing a throttle limit), since such a range isn't a single
addressable job; select an individual task instead.

```{only} html
![Viewing the details of a selected job](../animations/job_details.gif)
```

## Managing existing jobs in the queue

Select one or more rows in the queue (**Command**/**Ctrl** or **Shift**
clicking extends the selection) to enable a row of action buttons above
the table:

- **Cancel** — cancels the selected job(s) via `scancel`.
- **Pause** — a single button that Holds (`scontrol hold`) any selected
  *pending* job and Suspends (`scontrol suspend`, sends `SIGSTOP`) any
  selected *running* job, applying whichever is relevant to each row in a
  mixed selection. Already-held jobs are left alone (Slurm treats a
  repeated hold as a no-op).
- **Resume** — the corresponding "unpause": Releases (`scontrol release`)
  any selected *held* job and Resumes (`scontrol resume`, sends
  `SIGCONT`) any selected *suspended* job. Jobs held by an administrator
  (e.g. automatically, after a suspended job is requeued) can't be
  released by a regular user and are excluded.
- **Requeue** / **Requeue & Hold** — a split button that requeues the
  selected job(s) (`scontrol requeue`), optionally holding them
  immediately afterward (`scontrol requeuehold`); pick the mode from the
  small dropdown arrow. Requeuing a *suspended* job always results in an
  admin-only hold, regardless of which mode is chosen, so a confirmation
  dialog appears first in that case.

Each button's badge shows how many of the selected rows the action
actually applies to (e.g. `2/5`), since a mixed selection may include rows
an action doesn't apply to. Rows become temporarily disabled until the
request finishes, after which a dismissable success/failure alert appears
beneath the queue.

```{only} html
![Performing some actions on existing jobs. An action on another user's job fails.](../animations/manage_existing.gif)
```

```{note}
Earlier versions of this extension also let users submit new batch jobs
(via a path to an existing script, or a raw script pasted into a form)
directly from the queue toolbar. That submission UI has since been
removed from the frontend; the backend `POST /sbatch` endpoint is still
implemented (see {ref}`api`) but is not currently wired up to any control
in the extension's interface.
```
