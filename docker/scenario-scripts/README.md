# Scenario Scripts

Self-contained scripts, one per realistic HPC user scenario, for manually
exercising `jupyterlab-slurm` against the local Docker Slurm cluster +
JupyterHub rig. Each script submits real jobs via `sbatch`/`scontrol` and
pauses at checkpoints so you can go check the browser before continuing.

## Prerequisites

- Slurm Docker cluster running: `docker/cluster.sh up`
- JupyterHub rig running with demo users provisioned:
  `docker/cluster.sh users` (once) then `docker/cluster.sh hub-up`
- `testuser1`/`testuser2` (password same as username) available at
  `http://127.0.0.1:8000`

## Usage

Each script is independently runnable:

```bash
bash docker/scenario-scripts/01_first_submission.sh
```

Run whichever scenario you want to test that day, in any order. When done
testing (or before switching scenarios), reset the queue with:

```bash
bash docker/scenario-scripts/cleanup.sh
```

## Scenarios

| Script | Scenario |
| --- | --- |
| `01_first_submission.sh` | New user's first job: PD -> R transition, Job Details before/after start, malformed submission rejection |
| `02_job_failure_diagnosis.sh` | Job failure diagnosis: plain nonzero exit, OOM-kill (genuinely enforced), wall-time TIMEOUT |
| `03_suspend_resume.sh` | Suspend/Resume a running job; permission-denied on another user's job |
| `04_requeue_retry.sh` | Requeue/Requeue & Hold, including the `MinJobAge` window behavior for a completed job. Job History now also has its own Requeue/Requeue & Hold split button (previously only in the live Queue toolbar), since a finished job disappears from the Queue before it's necessarily purged from the controller |
| `05_array_bulk_management.sh` | Throttled job array + bulk select/Kill/Hold/Requeue across multiple jobs |
| `06_resource_usage_check.sh` | CPU-bound vs. sleeping job -- comparing CPU time vs. elapsed time in Job Details |
| `07_gpu_jobs.sh` | GPU scheduling/GRES via fake GRES (`gres.conf` `File=` entries); requires GPU partition/node already configured |
| `08_file_open_edit.sh` | Real-script job (Edit/Open Folder works) vs. `--wrap` job (disabled with tooltip) |
| `09_multi_user_visibility.sh` | "My jobs only" filtering and cross-user action denial (testuser1 vs. testuser2) |
| `10_long_session_refresh.sh` | Selection/pinning persistence across multiple auto-refresh cycles, tab switching, sorting |
| `11_infra_failure.sh` | Stops/restarts `slurmctld` to exercise infra-failure error handling and recovery |

## Notes

- All scripts submit jobs as `testuser1` (and `testuser2` where relevant)
  directly on the `slurmctld` container via `docker exec`, using the
  shared `/data` volume for job scripts/output (per this session's finding
  that `testuser1`'s home directory is *not* shared between the controller
  and worker containers -- only `/data`/`/home/ood` are).
- `07_gpu_jobs.sh` assumes fake GPU GRES has already been configured on the
  cluster (see the "Synthetic GRES Configuration" recipe: `AutoDetect=off`
  in `gres.conf`, `GresTypes=gpu` + `Gres=gpu:nvidia:N` in `slurm.conf`, and
  a `File=` device-path entry per GPU in `gres.conf` -- a bare `Count=`
  without `File=` is treated as zero real devices). It does not configure
  this itself, since it involves editing the shared cluster config. Note
  that a full image rebuild (`docker compose build --no-cache` + container
  recreate, e.g. as required by the cgroup.conf change below) wipes node
  `g1`'s runtime GPU registration -- the script checks for this and warns,
  but you'll need to redo the GRES setup from scratch if it happens.
- The cluster's `cgroup.conf` now has `ConstrainRAMSpace=yes` and
  `ConstrainSwapSpace=yes`, so `--mem` limits are genuinely enforced and
  `02_job_failure_diagnosis.sh`'s OOM job reliably reaches `OUT_OF_MEMORY`
  (previously memory limits weren't enforced at all, and later excess
  memory was just transparently swapped instead of triggering an OOM-kill).
- `common.sh` provides `submit_as`, `run_as`, `wait_for_state`,
  `print_checkpoint`, `ensure_scenario_dir`, and `write_script_as` helpers
  shared by every scenario script.
