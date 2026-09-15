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
import {
  isPathLike,
  resolveForActions,
  toRootRelativePath
} from '../utils/paths';

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
  // The Jupyter server's Contents root (ServerApp.root_dir). When known,
  // Edit/Open-Folder are visually disabled (not hidden, so the user can
  // still see the action exists and hover for why it's unavailable) rather
  // than left clickable-but-silently-broken, for any path outside this root
  // (which docmanager/filebrowser can never open) or, for Stdout/Stderr, a
  // path the server has confirmed doesn't exist (fileExists === false).
  rootDir?: string | null;
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
  rootDir,
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
  // Path actions (Edit/Open Folder) are always rendered -- never hidden --
  // for any field that is *conceptually* a path/command field (isPath or
  // isCommand), so the toolbar/field layout stays stable and the user can
  // always see the action exists. They're disabled (with an explanatory
  // tooltip) whenever there's no resolvable path at all -- e.g. a
  // `--wrap`-style job with no associated script file, or a `—` (empty)
  // value -- rather than being hidden, matching the "disable, don't hide"
  // convention used everywhere else in this UI.
  const showPathActions = isCommand || isPath;
  const noResolvablePath = !resolved || !isPathLike(resolved);
  // Only visually disable (not hide) Edit/Open-Folder once `rootDir` is
  // actually known -- while it's still loading, `undefined` would otherwise
  // make every path look permanently out-of-scope. Once known: a path
  // outside `rootDir` can never be opened via docmanager/filebrowser from
  // this server, and (for Stdout/Stderr specifically) a path the server has
  // confirmed doesn't exist isn't worth opening either.
  const pathOutOfRoot =
    rootDir !== null &&
    rootDir !== undefined &&
    !!resolved &&
    toRootRelativePath(resolved, rootDir) === undefined;
  const pathActionsDisabled =
    noResolvablePath || pathOutOfRoot || fileExists === false;
  const isEmptyValue =
    value === '—' || value === '' || value === null || value === undefined;

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
            sx={
              expanded
                ? {
                    maxWidth: '60ch',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'break-word'
                  }
                : {
                    maxWidth: '60ch',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }
            }
          >
            {display}
          </Typography>
        </Tooltip>
        {showPathActions && (
          <>
            <Tooltip
              title={
                noResolvablePath
                  ? 'No associated script file'
                  : pathOutOfRoot
                    ? "Outside this server's root directory"
                    : 'Open in Editor'
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={pathActionsDisabled}
                  onClick={() => onOpenInEditor?.(resolved!)}
                  aria-label="Open in Editor"
                >
                  <EditNoteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={
                noResolvablePath
                  ? 'No associated script file'
                  : pathOutOfRoot
                    ? "Outside this server's root directory"
                    : 'Open containing folder'
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={pathActionsDisabled}
                  onClick={() => onOpenFolder?.(resolved!)}
                  aria-label="Open folder"
                >
                  <FolderOpenIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
        <Tooltip title="Copy command">
          <span>
            <IconButton
              size="small"
              disabled={isEmptyValue}
              onClick={() => onCopy?.(v)}
              aria-label="Copy command"
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {truncated && onToggleExpand && (
          <Button size="small" onClick={onToggleExpand}>
            {expanded ? 'Show Less' : 'Show Full'}
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
              <Tooltip
                title={
                  isEmptyValue
                    ? 'No path available'
                    : fileExists === false
                      ? 'File not found'
                      : pathOutOfRoot
                        ? "Outside this server's root directory"
                        : 'Open in Editor'
                }
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={pathActionsDisabled}
                    onClick={() => onOpenInEditor?.(resolved!)}
                    aria-label="Open in Editor"
                  >
                    <EditNoteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip
              title={
                isEmptyValue
                  ? 'No path available'
                  : fileExists === false
                    ? 'File not found'
                    : pathOutOfRoot
                      ? "Outside this server's root directory"
                      : isDirectory
                        ? 'Open folder'
                        : 'Open containing folder'
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={pathActionsDisabled}
                  onClick={() => onOpenFolder?.(resolved!)}
                  aria-label="Open folder"
                >
                  <FolderOpenIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
        {!isDirectory && (
          <Tooltip title="Copy path">
            <span>
              <IconButton
                size="small"
                disabled={isEmptyValue}
                onClick={() => onCopy?.(v)}
                aria-label="Copy path"
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </span>
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
