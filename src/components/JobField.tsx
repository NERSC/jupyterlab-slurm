import React from 'react';
import {
  Stack,
  Typography,
  Tooltip,
  IconButton,
  Button,
  Chip
} from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { isPathLike, resolveForActions } from '../utils/paths';

export interface IJobFieldProps {
  label: string;
  value: any;
  fieldKey: string;
  workDir?: string;
  isPath?: boolean;
  isCommand?: boolean;
  isStatus?: boolean;
  isReason?: boolean;
  commandScript?: string;
  fileExists?: boolean;
  fileSize?: number;
  onOpenInEditor?: (path: string) => void;
  onOpenFolder?: (path: string) => void;
  onCopy?: (text: string) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  minLabelWidth?: number | string;
}

export const JobField: React.FC<IJobFieldProps> = ({
  label,
  value,
  fieldKey,
  workDir,
  isPath = false,
  isCommand = false,
  isStatus = false,
  isReason = false,
  commandScript,
  fileExists,
  fileSize,
  onOpenInEditor,
  onOpenFolder,
  onCopy,
  expanded = false,
  onToggleExpand,
  minLabelWidth = 96
}) => {
  if (value === undefined || value === null) {
    value = '—';
  }

  const resolved = isCommand
    ? resolveForActions(commandScript ?? undefined, workDir)
    : isPath
      ? resolveForActions(
          typeof value === 'string' ? value : undefined,
          workDir
        )
      : undefined;
  const showPathActions = resolved && isPathLike(resolved);

  if (isCommand) {
    const v = value as string;
    const truncated = v.length > 80;
    const display = expanded || !truncated ? v : `${v.slice(0, 77)}…`;

    return (
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" sx={{ minWidth: minLabelWidth }}>
          {label}:
        </Typography>
        <Tooltip
          title={v && resolved && resolved !== v ? `${v}\n→ ${resolved}` : v}
          disableHoverListener={!truncated}
        >
          <Typography
            variant="body2"
            sx={{
              maxWidth: '60ch',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {display}
          </Typography>
        </Tooltip>
        {showPathActions && (
          <>
            <Tooltip title="Open in Editor">
              <IconButton
                size="small"
                onClick={() => onOpenInEditor?.(resolved!)}
                aria-label="Open in Editor"
              >
                <EditNoteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open containing folder">
              <IconButton
                size="small"
                onClick={() => onOpenFolder?.(resolved!)}
                aria-label="Open folder"
              >
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Tooltip title="Copy command">
          <IconButton
            size="small"
            onClick={() => onCopy?.(v)}
            aria-label="Copy command"
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {truncated && onToggleExpand && (
          <Button size="small" onClick={onToggleExpand}>
            {expanded ? 'Show less' : 'Show full'}
          </Button>
        )}
      </Stack>
    );
  }

  if (isPath) {
    const v = value as string;
    const isDirectory = fieldKey === 'WorkDir';
    const sizeLabel =
      fileSize !== null && fileSize !== undefined && fileSize > 0
        ? fileSize < 1024
          ? `${fileSize} B`
          : fileSize < 1048576
            ? `${(fileSize / 1024).toFixed(1)} KB`
            : `${(fileSize / 1048576).toFixed(1)} MB`
        : null;
    return (
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" sx={{ minWidth: minLabelWidth }}>
          {label}:
        </Typography>
        <Tooltip
          title={v && resolved && resolved !== v ? `${v}\n→ ${resolved}` : v}
        >
          <Typography
            variant="body2"
            sx={{
              maxWidth: '50ch',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {v}
          </Typography>
        </Tooltip>
        {fileExists === true && sizeLabel && (
          <Chip
            size="small"
            label={sizeLabel}
            color="success"
            variant="outlined"
          />
        )}
        {fileExists === true && fileSize === 0 && (
          <Chip size="small" label="empty" color="warning" variant="outlined" />
        )}
        {fileExists === false && v && v !== '—' && (
          <Chip
            size="small"
            label="not found"
            color="error"
            variant="outlined"
          />
        )}
        {showPathActions && (
          <>
            {!isDirectory && (
              <Tooltip title="Open in Editor">
                <IconButton
                  size="small"
                  onClick={() => onOpenInEditor?.(resolved!)}
                  aria-label="Open in Editor"
                >
                  <EditNoteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip
              title={isDirectory ? 'Open folder' : 'Open containing folder'}
            >
              <IconButton
                size="small"
                onClick={() => onOpenFolder?.(resolved!)}
                aria-label="Open folder"
              >
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
        {!isDirectory && (
          <Tooltip title="Copy path">
            <IconButton
              size="small"
              onClick={() => onCopy?.(v)}
              aria-label="Copy path"
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    );
  }

  // State/Reason are rendered as color-coded text rather than a redundant
  // Chip: a Chip placed next to the value just repeated the same text a
  // second time with no additional information.
  const statusColor = isStatus
    ? /^(COMPLETED|RUNNING|R)$/i.test(String(value))
      ? 'success.main'
      : /^(FAILED|CANCELLED|TIMEOUT|OUT_OF_MEMORY|NODE_FAIL)$/i.test(
            String(value)
          )
        ? 'error.main'
        : /^(PENDING|PD|HELD|CONFIGURING)$/i.test(String(value))
          ? 'warning.main'
          : 'text.primary'
    : isReason && value !== '—' && value !== 'None'
      ? 'warning.main'
      : 'text.primary';

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Typography variant="body2" sx={{ minWidth: minLabelWidth }}>
        {label}:
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: statusColor,
          fontWeight: isStatus || isReason ? 600 : 400
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
};
