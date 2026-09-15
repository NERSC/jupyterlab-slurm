import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JobDetailsPanel from '../../src/components/JobDetailsPanel';
import { useJobDetails } from '../../src/hooks/useJobDetails';

// `@jupyterlab/apputils` doesn't transform cleanly under Jest (its
// dependency chain pulls in `@jupyter/react-components`, which ships raw
// ESM `export`); mock it the same way `SqueueDataTable.spec.tsx` does.
const mockNotificationWarning = jest.fn();
jest.mock('@jupyterlab/apputils', () => ({
  Notification: {
    warning: (...args: any[]) => mockNotificationWarning(...args)
  }
}));

jest.mock('../../src/hooks/useJobDetails');

const mockUseJobDetails = useJobDetails as jest.MockedFunction<
  typeof useJobDetails
>;

function makeApp() {
  return {
    commands: { execute: jest.fn().mockResolvedValue(undefined) }
  } as any;
}

const LOADED = {
  uiCfg: { details_labels: { JobID: 'Job ID', State: 'State' } },
  loading: false,
  error: null as string | null,
  fields: {
    JobID: '7040',
    JobName: 'slurm_test',
    User: 'testuser',
    State: 'COMPLETED',
    ExitCode: '0:0',
    Elapsed: '00:01:23',
    NodeList: 'nid00123',
    CPUs: '1',
    WorkDir: '/global/home/u/testuser',
    Stdout: '/global/home/u/testuser/slurm-7040.out',
    Stderr: '/global/home/u/testuser/slurm-7040.err'
  } as Record<string, any>,
  steps: [
    {
      JobID: '7040.batch',
      State: 'COMPLETED',
      ExitCode: '0:0',
      Elapsed: '00:01:20'
    }
  ],
  nextPollAt: null as Date | null,
  pollIntervalMs: 15000,
  refresh: jest.fn()
};

describe('JobDetailsPanel', () => {
  beforeEach(() => {
    mockUseJobDetails.mockReset();
    // Provide a clipboard stub for copy actions.
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) }
    });
  });

  test('shows a loading indicator while details are loading', () => {
    mockUseJobDetails.mockReturnValue({
      uiCfg: {},
      loading: true,
      error: null,
      fields: null,
      steps: [],
      refresh: jest.fn()
    } as any);

    render(<JobDetailsPanel app={makeApp()} jobIds={['7040']} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  test('renders an error message when the hook reports an error', () => {
    mockUseJobDetails.mockReturnValue({
      uiCfg: {},
      loading: false,
      error: 'Bad job array element specified: 7040_2',
      fields: null,
      steps: [],
      refresh: jest.fn()
    } as any);

    render(<JobDetailsPanel app={makeApp()} jobIds={['7040_2']} />);
    expect(
      screen.getByText('Bad job array element specified: 7040_2')
    ).toBeInTheDocument();
  });

  test('renders job summary, steps, and log fields when loaded', () => {
    mockUseJobDetails.mockReturnValue(LOADED as any);
    render(<JobDetailsPanel app={makeApp()} jobIds={['7040']} />);

    // Header shows the current job id.
    expect(screen.getByText('Job 7040')).toBeInTheDocument();
    // Section headers.
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Timing')).toBeInTheDocument();
    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getByText('Steps')).toBeInTheDocument();
    expect(screen.getByText('Logs')).toBeInTheDocument();
    // Step row rendered.
    expect(screen.getByText('7040.batch')).toBeInTheDocument();
    // Custom label from uiCfg applied for JobID.
    expect(screen.getByText('Job ID:')).toBeInTheDocument();
  });

  test('navigation buttons move between jobs in the snapshot', () => {
    mockUseJobDetails.mockReturnValue(LOADED as any);
    const onSnapshotChange = jest.fn();
    render(
      <JobDetailsPanel
        app={makeApp()}
        jobIds={['7040', '7041', '7042']}
        initialIndex={0}
        onSnapshotChange={onSnapshotChange}
      />
    );

    // At the first job, Previous is disabled.
    const prev = screen.getByLabelText('Previous job');
    const next = screen.getByLabelText('Next job');
    expect(prev).toBeDisabled();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    fireEvent.click(next);
    expect(onSnapshotChange).toHaveBeenCalledWith(['7040', '7041', '7042'], 1);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  test('copy JSON writes the fields to the clipboard', async () => {
    mockUseJobDetails.mockReturnValue(LOADED as any);
    render(<JobDetailsPanel app={makeApp()} jobIds={['7040']} />);

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalled()
    );
    const written = (navigator.clipboard.writeText as jest.Mock).mock
      .calls[0][0];
    expect(written).toContain('"JobID": "7040"');
  });

  test('sets the badge to the number of jobs', () => {
    mockUseJobDetails.mockReturnValue(LOADED as any);
    const setBadge = jest.fn();
    render(
      <JobDetailsPanel
        app={makeApp()}
        jobIds={['7040', '7041']}
        setBadge={setBadge}
      />
    );
    expect(setBadge).toHaveBeenCalledWith(2);
  });

  test('does not show a "Next update" timer when no poll is scheduled (terminal job)', () => {
    mockUseJobDetails.mockReturnValue(LOADED as any);
    render(<JobDetailsPanel app={makeApp()} jobIds={['7040']} />);
    expect(screen.queryByText(/Next update in/)).not.toBeInTheDocument();
  });

  test('shows a "Next update" pie timer countdown when a poll is scheduled', () => {
    mockUseJobDetails.mockReturnValue({
      ...LOADED,
      fields: { ...LOADED.fields, State: 'RUNNING' },
      nextPollAt: new Date(Date.now() + 15000),
      pollIntervalMs: 15000
    } as any);
    render(<JobDetailsPanel app={makeApp()} jobIds={['7040']} />);
    expect(screen.getByText(/Next update in \d+s/)).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', {
        name: 'Time until next job details update'
      })
    ).toBeInTheDocument();
  });
});
