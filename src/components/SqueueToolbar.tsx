import React from 'react';
import {
  Badge,
  Button,
  ButtonGroup,
  Fade,
  TextField,
  FormControlLabel,
  Switch
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DeselectIcon from '@mui/icons-material/Deselect';
import InfoIcon from '@mui/icons-material/Info';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import Grid from '@mui/material/Grid2';
import { JobAction } from '../types';

interface ISqueueToolbarProps {
  filterQuery: string;
  setFilterQuery: (val: string) => void;
  autoReload: boolean;
  onReloadClick: () => void;
  disableManualRefresh: boolean;
  selectedCount: number;
  onClearSelected: () => void;
  onShowDetails: () => void;
  onJobAction: (action: JobAction) => void;
  userOnly: boolean;
  onUserOnlyClick: () => void;
  showSelectedOnly: boolean;
  onShowSelectedOnlyClick: () => void;
}

export const SqueueToolbar: React.FC<ISqueueToolbarProps> = ({
  filterQuery,
  setFilterQuery,
  autoReload,
  onReloadClick,
  disableManualRefresh,
  selectedCount,
  onClearSelected,
  onShowDetails,
  onJobAction,
  userOnly,
  onUserOnlyClick,
  showSelectedOnly,
  onShowSelectedOnlyClick
}) => {
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
          <Button disabled={selectedCount === 0} onClick={onClearSelected}>
            <DeselectIcon />
            Clear Selected
            {selectedCount > 0 && (
              <Badge
                className={'jp-SlurmWidget-table-button-badge'}
                badgeContent={selectedCount}
                color={'secondary'}
              />
            )}
          </Button>
          <Button
            className="jp-SlurmWidget-table-button"
            disabled={selectedCount === 0}
            onClick={onShowDetails}
          >
            <InfoIcon />
            Show details
            {selectedCount > 0 && (
              <Badge
                className={'jp-SlurmWidget-table-button-badge'}
                badgeContent={selectedCount}
                color={'secondary'}
              />
            )}
          </Button>
          <Button
            className="jp-SlurmWidget-table-button"
            disabled={selectedCount === 0}
            onClick={() => onJobAction('kill')}
          >
            <DeleteIcon />
            Kill Job(s)
          </Button>
          <Button
            className="jp-SlurmWidget-table-button"
            disabled={selectedCount === 0}
            onClick={() => onJobAction('hold')}
          >
            <PauseCircleOutlineIcon />
            Hold
          </Button>
          <Button
            className="jp-SlurmWidget-table-button"
            disabled={selectedCount === 0}
            onClick={() => onJobAction('release')}
          >
            <PlayCircleOutlineIcon />
            Release
          </Button>
        </ButtonGroup>
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
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showSelectedOnly}
              onChange={onShowSelectedOnlyClick}
              disabled={selectedCount === 0}
            />
          }
          label="Selected only"
        />
      </Grid>
    </Grid>
  );
};
