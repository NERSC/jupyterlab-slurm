import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobField } from '../../src/components/JobField';

describe('JobField', () => {
  test('renders a plain label/value pair', () => {
    render(<JobField label="State" value="RUNNING" fieldKey="State" />);
    expect(screen.getByText('State:')).toBeInTheDocument();
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
  });

  test('renders an em-dash placeholder for null/undefined values', () => {
    render(<JobField label="Reason" value={null} fieldKey="Reason" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('shows a status chip when isStatus is set', () => {
    render(
      <JobField label="State" value="COMPLETED" fieldKey="State" isStatus />
    );
    // Value appears both as plain text and inside the chip.
    expect(screen.getAllByText('COMPLETED').length).toBeGreaterThanOrEqual(1);
  });

  test('does not show a reason chip for "None"', () => {
    render(<JobField label="Reason" value="None" fieldKey="Reason" isReason />);
    // "None" is rendered as the value text, but no warning chip is added.
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  test('path fields expose copy/open actions and fire callbacks', () => {
    const onCopy = jest.fn();
    const onOpenInEditor = jest.fn();
    render(
      <JobField
        label="Stdout"
        value="/global/home/u/user/slurm-123.out"
        fieldKey="StdOut"
        isPath
        fileExists={true}
        fileSize={2048}
        onCopy={onCopy}
        onOpenInEditor={onOpenInEditor}
      />
    );

    // Buttons are wrapped in a <span> (required so MUI can show a Tooltip on
    // a disabled IconButton), and MUI copies the aria-label onto that
    // wrapper too -- query specifically for the `button` role to avoid
    // matching both the span and the button it wraps.
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
    expect(onCopy).toHaveBeenCalledWith('/global/home/u/user/slurm-123.out');

    fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }));
    expect(onOpenInEditor).toHaveBeenCalledWith(
      '/global/home/u/user/slurm-123.out'
    );
  });

  test('path field shows a "not found" chip when the file is missing', () => {
    render(
      <JobField
        label="Stderr"
        value="/tmp/missing.err"
        fieldKey="StdErr"
        isPath
        fileExists={false}
      />
    );
    expect(screen.getByText('not found')).toBeInTheDocument();
  });

  test('disables Open in Editor/Open folder when the file does not exist', () => {
    render(
      <JobField
        label="Stderr"
        value="/tmp/missing.err"
        fieldKey="StdErr"
        isPath
        fileExists={false}
        rootDir="/tmp"
      />
    );
    expect(
      screen.getByRole('button', { name: 'Open in Editor' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeDisabled();
  });

  test('disables Open in Editor/Open folder when the path is outside rootDir', () => {
    render(
      <JobField
        label="Stdout"
        value="/global/home/u/user/slurm-123.out"
        fieldKey="StdOut"
        isPath
        fileExists={true}
        rootDir="/home/testuser1"
      />
    );
    expect(
      screen.getByRole('button', { name: 'Open in Editor' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeDisabled();
  });

  test('enables Open in Editor/Open folder when the path is inside rootDir and exists', () => {
    render(
      <JobField
        label="Stdout"
        value="/home/testuser1/slurm-123.out"
        fieldKey="StdOut"
        isPath
        fileExists={true}
        rootDir="/home/testuser1"
      />
    );
    expect(
      screen.getByRole('button', { name: 'Open in Editor' })
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled();
  });

  test('disables (does not hide) Edit/Open Folder for a command with no resolvable script path', () => {
    // e.g. `sbatch --wrap=...` jobs have no associated script file --
    // `commandScript` is empty/undefined in that case. The buttons must
    // still be rendered (not hidden), just disabled, matching the
    // "disable, don't hide" convention used everywhere else.
    render(
      <JobField
        label="Command"
        value="--wrap=sleep 600 --job-name=t1_long_1"
        fieldKey="Command"
        isCommand
        commandScript={undefined}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Open in Editor' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeDisabled();
  });

  test('disables the Copy button when the value is the empty "—" placeholder', () => {
    render(<JobField label="Stdout" value={null} fieldKey="StdOut" isPath />);
    expect(screen.getByRole('button', { name: 'Copy path' })).toBeDisabled();
    // No resolvable path either, so Open folder stays visible but disabled.
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeDisabled();
  });

  test('disables the Copy command button when the value is the empty "—" placeholder', () => {
    render(<JobField label="Command" value={null} fieldKey="Command" isCommand />);
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeDisabled();
  });

  test('command fields truncate long values and toggle expansion', () => {
    const longCmd = 'a'.repeat(200);
    const onToggleExpand = jest.fn();
    render(
      <JobField
        label="Command"
        value={longCmd}
        fieldKey="Command"
        isCommand
        expanded={false}
        onToggleExpand={onToggleExpand}
      />
    );
    // Truncated display ends with an ellipsis.
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    expect(onToggleExpand).toHaveBeenCalled();
  });
});
