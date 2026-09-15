import React from 'react';
import {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Fade,
  TextField,
  FormControlLabel,
  Switch,
  Tooltip,
  Menu,
  MenuItem,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import StopIcon from '@mui/icons-material/Stop';
import DeselectIcon from '@mui/icons-material/Deselect';
import InfoIcon from '@mui/icons-material/Info';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import Grid from '@mui/material/Grid2';
import { JobAction } from '../types';

interface ISqueueToolbarProps {
  filterQuery: string;
  setFilterQuery: (val: string) => void;
  autoReload: boolean;
  onReloadClick: () => void;
  disableManualRefresh: boolean;
  selectedCount: number;
  // Hold/Release are genuine no-ops on anything but a PENDING job -- real
  // Slurm accepts `scontrol hold`/`scontrol release` on a RUNNING/COMPLETED
  // job (exit code 0) but doesn't actually change its state, which
  // previously still triggered a misleading "success" flash on the row.
  // `true` when every selected row is a valid target (or state can't be
  // determined at all, in which case we don't second-guess the user).
  canHoldSelected: boolean;
  canReleaseSelected: boolean;
  // Suspend/Resume are the runtime-control analog of Hold/Release: Suspend
  // only applies to a RUNNING job (SIGSTOP, keeps allocation), Resume only
  // to one that's actually suspended (ST=S). Same "true if we can't
  // determine state" fallback as Hold/Release.
  canSuspendSelected: boolean;
  canResumeSelected: boolean;
  // Requeue/Requeue & Hold apply to both PENDING and RUNNING jobs, so
  // there's no disqualifying state to gate on beyond having a selection.
  canRequeueSelected: boolean;
  // True when any selected job is held with an *admin* hold (e.g. real
  // Slurm applies this automatically when a SUSPENDED job is requeued).
  // Regular users can't `scontrol release` an admin hold -- it always
  // fails with "Access/permission denied" -- so Resume must be disabled
  // for this case instead of letting the user hit that confusing error.
  hasAdminHoldSelected: boolean;
  // True when any selected job is currently SUSPENDED. Requeuing a
  // suspended job is real Slurm behavior that lands the job on the same
  // admin-only hold described above -- the user has no way to undo it
  // themselves. Used to warn (tooltip) and confirm (dialog) before firing
  // Requeue/Requeue & Hold on such a selection.
  hasSuspendedSelected: boolean;
  // Whether *any* (not necessarily all) selected job is PD/R/S,
  // respectively. Used to allow "Pause"/"Resume" to fire on a mixed
  // selection (e.g. a throttled array job's pending tail alongside its
  // running tasks) by dispatching both underlying actions -- `onJobAction`
  // filters each one down to its applicable rows.
  hasPdSelected: boolean;
  hasRSelected: boolean;
  hasSSelected: boolean;
  // Narrower than hasPdSelected: true only when a selected PENDING row is
  // actually held (Reason matches isHeldReason). A plain pending job
  // (e.g. Reason=(Priority)/(Resources)) is not a valid Release target --
  // real Slurm's `scontrol release` is a silent no-op on it -- so the
  // merged Release/Resume button must key off this, not hasPdSelected.
  hasHeldSelected: boolean;
  // Narrower than hasPdSelected: true only when a selected PENDING row is
  // NOT already held. Used by the merged Pause/Suspend button, which must
  // NOT enable/fire Hold on a job that's already held -- real Slurm's
  // `scontrol hold` is a silent no-op on it (mirrors hasHeldSelected's
  // gating of Release).
  hasUnheldPdSelected: boolean;
  // Number of selected rows the Pause/Resume/Requeue action would actually
  // apply to, out of the total selection -- rendered as an "applicable/
  // total" badge (e.g. "2/5") on those buttons, unlike Clear/Details'
  // plain total-count badge, since Pause/Resume/Requeue only ever act on
  // a subset of an arbitrary selection.
  pauseApplicableCount: number;
  resumeApplicableCount: number;
  requeueApplicableCount: number;
  // True when any selected row represents a *grouped* range of still-
  // pending array tasks (e.g. "1234_[3-20%4]", squeue's display form for
  // array elements sharing a throttle limit) rather than one specific,
  // addressable job. `/job/{id}` can't resolve such a range -- Details
  // must be disabled here instead of surfacing a raw "Invalid job_id"
  // error.
  hasGroupedArrayRangeSelected: boolean;
  onClearSelected: () => void;
  onShowDetails: () => void;
  onJobAction: (action: JobAction) => void;
  userOnly: boolean;
  onUserOnlyClick: () => void;
}

export const SqueueToolbar: React.FC<ISqueueToolbarProps> = ({
  filterQuery,
  setFilterQuery,
  autoReload,
  onReloadClick,
  disableManualRefresh,
  selectedCount,
  canHoldSelected,
  canReleaseSelected,
  canSuspendSelected,
  canResumeSelected,
  canRequeueSelected,
  hasAdminHoldSelected,
  hasSuspendedSelected,
  hasGroupedArrayRangeSelected,
  hasPdSelected,
  hasRSelected,
  hasSSelected,
  hasHeldSelected,
  hasUnheldPdSelected,
  pauseApplicableCount,
  resumeApplicableCount,
  requeueApplicableCount,
  onClearSelected,
  onShowDetails,
  onJobAction,
  userOnly,
  onUserOnlyClick
}) => {
  // Requeue/Requeue & Hold are presented as a single MUI "split button":
  // the main segment fires whichever option was last chosen (defaulting to
  // plain Requeue), and the small arrow segment opens a menu to pick between
  // the two. This keeps the toolbar's real-estate footprint to one
  // button-sized control instead of two separate buttons.
  const [requeueMenuAnchor, setRequeueMenuAnchor] =
    React.useState<HTMLElement | null>(null);
  const [requeueOption, setRequeueOption] = React.useState<
    'requeue' | 'requeuehold'
  >('requeue');
  // Requeuing a SUSPENDED job always results in an admin-only hold that a
  // regular user cannot lift themselves -- confirm before firing the
  // action in that case, since it's effectively a one-way trap for them.
  const [requeueConfirmOpen, setRequeueConfirmOpen] = React.useState(false);

  const fireRequeue = () => {
    if (hasSuspendedSelected) {
      setRequeueConfirmOpen(true);
    } else {
      onJobAction(requeueOption);
    }
  };

  // Keep the split button's main-segment label fixed ("Requeue") regardless
  // of which option is currently chosen, rather than swapping in the much
  // longer "Requeue & Hold" text. Letting the label grow/shrink based on
  // selection made this one button visibly wider than its neighbors
  // whenever "Requeue & Hold" was picked, breaking the toolbar's otherwise
  // consistent button sizing. The chosen mode is still fully communicated
  // via the tooltip and the checked state in the dropdown menu below.

  // Hold and Suspend share the same real-world intent ("pause this job for
  // now") but apply to disjoint states (PD vs. R), so they're presented as
  // a single "Pause" button. Rather than requiring a *uniform* selection
  // (all PD or all R) to enable the button at all, it's enabled whenever
  // *any* selected job qualifies for either -- clicking it then fires
  // `hold` and/or `suspend` as applicable, each scoped by `onJobAction`
  // (see useSlurmQueue) to only the rows it actually applies to. This
  // lets e.g. "select all" on a mixed PD+R queue (a throttled array job's
  // pending tail alongside its running tasks) still Pause everything
  // pausable in one click, instead of being disabled entirely.
  const canPauseSelected =
    canHoldSelected ||
    canSuspendSelected ||
    hasUnheldPdSelected ||
    hasRSelected;
  const firePause = () => {
    if (hasUnheldPdSelected) {
      onJobAction('hold');
    }
    if (hasRSelected) {
      onJobAction('suspend');
    }
  };

  // Release and Resume are the corresponding "unpause" pair, with the same
  // "any applicable row" eligibility as Pause. `onJobAction('release')`
  // already excludes admin-held jobs when scoping its rows (see
  // useSlurmQueue), so this naturally skips them rather than letting
  // `release` fail with a permission error -- `hasAdminHoldSelected` is
  // only used here to give a clearer tooltip.
  const canResumeAvailable =
    canReleaseSelected || canResumeSelected || hasHeldSelected || hasSSelected;
  const fireResume = () => {
    if (hasHeldSelected) {
      onJobAction('release');
    }
    if (hasSSelected) {
      onJobAction('resume');
    }
  };

  return (
    <Grid container className={'jp-SlurmWidget-row'}>
      <Grid>
        <TextField
          className="jp-SlurmWidget-table-filter-input"
          label={'Filter with text'}
          variant="outlined"
          size="small"
          margin="dense"
          InputLabelProps={{ shrink: true }}
          value={filterQuery}
          onChange={event => setFilterQuery(event.target.value)}
        />
        <ButtonGroup size="small">
          <Fade in={!autoReload} unmountOnExit mountOnEnter>
            <Button onClick={onReloadClick} disabled={disableManualRefresh}>
              <ReplayIcon />
              Refresh
            </Button>
          </Fade>
          <Tooltip title="Clear the current selection">
            <span>
              <Button disabled={selectedCount === 0} onClick={onClearSelected}>
                <DeselectIcon />
                Clear
                {selectedCount > 0 && (
                  <Badge
                    className={'jp-SlurmWidget-table-button-badge'}
                    badgeContent={selectedCount}
                    color={'secondary'}
                  />
                )}
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              selectedCount > 0 && hasGroupedArrayRangeSelected
                ? "Details isn't available for a grouped range of pending array tasks -- select an individual task instead"
                : 'Show details for the selected job(s)'
            }
          >
            <span>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={selectedCount === 0 || hasGroupedArrayRangeSelected}
                onClick={onShowDetails}
              >
                <InfoIcon />
                Details
                {selectedCount > 0 && (
                  <Badge
                    className={'jp-SlurmWidget-table-button-badge'}
                    badgeContent={selectedCount}
                    color={'secondary'}
                  />
                )}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Cancel the selected job(s)">
            <span>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={selectedCount === 0}
                onClick={() => onJobAction('cancel')}
              >
                <StopIcon />
                Cancel
                {selectedCount > 0 && (
                  <Badge
                    className={'jp-SlurmWidget-table-button-badge'}
                    badgeContent={selectedCount}
                    color={'secondary'}
                  />
                )}
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              selectedCount > 0 && !canPauseSelected
                ? 'Pause only applies to jobs that are pending (Hold) or running (Suspend)'
                : hasPdSelected && hasRSelected
                  ? 'Hold the selected pending job(s) and Suspend the selected running job(s) (SIGSTOP)'
                  : hasPdSelected
                    ? 'Hold the selected pending job(s), locking them in the queue. For running jobs, Pause instead Suspends them (SIGSTOP), keeping their allocation'
                    : 'Suspend the selected running job(s) (SIGSTOP), keeping their allocation. For pending jobs, Pause instead Holds them, locking them in the queue'
            }
          >
            <span>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={selectedCount === 0 || !canPauseSelected}
                onClick={firePause}
              >
                <PauseCircleOutlineIcon />
                Pause
                {selectedCount > 0 && (
                  <Badge
                    className={'jp-SlurmWidget-table-button-badge'}
                    badgeContent={`${pauseApplicableCount}/${selectedCount}`}
                    color={'secondary'}
                  />
                )}
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              selectedCount > 0 && hasAdminHoldSelected && !canResumeAvailable
                ? 'This job is held by an administrator (e.g. after being requeued while suspended) and can only be released by an admin'
                : selectedCount > 0 && !canResumeAvailable
                  ? 'Resume only applies to jobs that are held/pending (Release) or suspended (Resume)'
                  : hasHeldSelected && hasSSelected
                    ? 'Release the selected held job(s) back into the queue and Resume (SIGCONT) the selected suspended job(s)'
                    : hasHeldSelected
                      ? 'Release the selected held job(s) back into the queue. For suspended jobs, Resume instead sends SIGCONT to unpause them'
                      : 'Resume the selected suspended job(s) (SIGCONT). For held/pending jobs, Resume instead Releases them back into the queue'
            }
          >
            <span>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={selectedCount === 0 || !canResumeAvailable}
                onClick={fireResume}
              >
                <PlayCircleOutlineIcon />
                Resume
                {selectedCount > 0 && (
                  <Badge
                    className={'jp-SlurmWidget-table-button-badge'}
                    badgeContent={`${resumeApplicableCount}/${selectedCount}`}
                    color={'secondary'}
                  />
                )}
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              selectedCount > 0 && !canRequeueSelected
                ? 'Requeue is not available for jobs that are already pending -- Slurm rejects requeuing a job that has not started running yet'
                : hasSuspendedSelected
                  ? 'Warning: requeuing a suspended job places it on an admin-only hold that only an administrator can release'
                  : requeueOption === 'requeue'
                    ? 'Requeue the selected job(s) from the beginning'
                    : 'Requeue the selected job(s) and immediately hold them'
            }
          >
            <ButtonGroup
              className="jp-SlurmWidget-table-button"
              size="small"
              disabled={selectedCount === 0 || !canRequeueSelected}
            >
              <Button onClick={fireRequeue}>
                {requeueOption === 'requeuehold' ? (
                  // Rather than swapping in a longer "Requeue & Hold" label
                  // (which widened this button relative to its neighbors) or
                  // a text "&H" superscript, the "& Hold" mode is conveyed by
                  // decorating the restart icon itself with a small pause
                  // glyph -- visually reading as "restart, then pause" -- so
                  // the button's footprint stays effectively icon-sized.
                  <Box className="jp-SlurmWidget-requeue-hold-icon">
                    <RestartAltIcon />
                    <PauseCircleOutlineIcon className="jp-SlurmWidget-requeue-hold-badge-icon" />
                  </Box>
                ) : (
                  <RestartAltIcon />
                )}
                Requeue
                {selectedCount > 0 && (
                  <Badge
                    className={'jp-SlurmWidget-table-button-badge'}
                    badgeContent={`${requeueApplicableCount}/${selectedCount}`}
                    color={'secondary'}
                  />
                )}
              </Button>
              <Button
                size="small"
                aria-label="select requeue option"
                onClick={event => setRequeueMenuAnchor(event.currentTarget)}
              >
                <ArrowDropDownIcon />
              </Button>
            </ButtonGroup>
          </Tooltip>
        </ButtonGroup>
        <Menu
          anchorEl={requeueMenuAnchor}
          open={Boolean(requeueMenuAnchor)}
          onClose={() => setRequeueMenuAnchor(null)}
        >
          <MenuItem
            selected={requeueOption === 'requeue'}
            onClick={() => {
              setRequeueOption('requeue');
              setRequeueMenuAnchor(null);
            }}
          >
            Requeue
          </MenuItem>
          <MenuItem
            selected={requeueOption === 'requeuehold'}
            onClick={() => {
              setRequeueOption('requeuehold');
              setRequeueMenuAnchor(null);
            }}
          >
            Requeue &amp; Hold
          </MenuItem>
        </Menu>
        <Dialog
          open={requeueConfirmOpen}
          onClose={() => setRequeueConfirmOpen(false)}
        >
          <DialogTitle>Requeue a suspended job?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              One or more selected jobs are currently suspended. Requeuing a
              suspended job will place it on an admin-only hold -- only an
              administrator will be able to release it; you will not be able to
              resume or release it yourself. Do you want to continue?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRequeueConfirmOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setRequeueConfirmOpen(false);
                onJobAction(requeueOption);
              }}
              autoFocus
            >
              Requeue Anyway
            </Button>
          </DialogActions>
        </Dialog>
      </Grid>
      <Grid sx={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={userOnly}
              onChange={onUserOnlyClick}
            />
          }
          label="My jobs only"
        />
      </Grid>
    </Grid>
  );
};
