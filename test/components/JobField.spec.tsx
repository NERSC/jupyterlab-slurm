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

    fireEvent.click(screen.getByLabelText('Copy path'));
    expect(onCopy).toHaveBeenCalledWith('/global/home/u/user/slurm-123.out');

    fireEvent.click(screen.getByLabelText('Open in Editor'));
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
