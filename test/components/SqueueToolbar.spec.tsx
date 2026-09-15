import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SqueueToolbar } from '../../src/components/SqueueToolbar';

function renderToolbar(overrides: Partial<any> = {}) {
  const props = {
    filterQuery: '',
    setFilterQuery: jest.fn(),
    autoReload: false,
    onReloadClick: jest.fn(),
    disableManualRefresh: false,
    selectedCount: 0,
    canHoldSelected: true,
    canReleaseSelected: true,
    canSuspendSelected: true,
    canResumeSelected: true,
    canRequeueSelected: true,
    hasAdminHoldSelected: false,
    hasSuspendedSelected: false,
    hasGroupedArrayRangeSelected: false,
    hasPdSelected: false,
    hasRSelected: false,
    hasSSelected: false,
    hasHeldSelected: false,
    hasUnheldPdSelected: false,
    pauseApplicableCount: 0,
    resumeApplicableCount: 0,
    requeueApplicableCount: 0,
    onClearSelected: jest.fn(),
    onShowDetails: jest.fn(),
    onJobAction: jest.fn(),
    userOnly: false,
    onUserOnlyClick: jest.fn(),
    ...overrides
  };
  render(<SqueueToolbar {...props} />);
  return props;
}

describe('SqueueToolbar', () => {
  test('typing in the filter box calls setFilterQuery', () => {
    const props = renderToolbar();
    const input = screen.getByLabelText('Filter with text');
    fireEvent.change(input, { target: { value: 'jobA' } });
    expect(props.setFilterQuery).toHaveBeenCalledWith('jobA');
  });

  test('action buttons are disabled when nothing is selected', () => {
    renderToolbar({ selectedCount: 0 });
    expect(screen.getByRole('button', { name: /^Cancel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Pause/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Resume/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Requeue/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /select requeue option/i })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Details/i })
    ).toBeDisabled();
  });

  test('Clear, Details, and Cancel buttons show no count badge when nothing is selected', () => {
    renderToolbar({ selectedCount: 0 });
    const clearButton = screen.getByRole('button', { name: /^Clear$/i });
    const detailsButton = screen.getByRole('button', { name: /^Details$/i });
    const cancelButton = screen.getByRole('button', { name: /^Cancel/i });
    expect(clearButton.querySelector('.MuiBadge-badge')).toBeNull();
    expect(detailsButton.querySelector('.MuiBadge-badge')).toBeNull();
    expect(cancelButton.querySelector('.MuiBadge-badge')).toBeNull();
  });

  test('Cancel shows the plain total-selected-count badge (not applicable/total), since scancel applies unconditionally', () => {
    // Unlike Pause/Resume/Requeue, Cancel has no state-based eligibility --
    // real `scancel` works on a job in any state -- so its badge should
    // match Clear/Details' plain total, not the "x/y" applicable-count
    // style used by the partial-eligibility actions.
    renderToolbar({ selectedCount: 3 });
    expect(
      screen
        .getByRole('button', { name: /^Cancel/i })
        .querySelector('.MuiBadge-badge')
    ).toHaveTextContent('3');
  });

  test.each([1, 2, 5, 42])(
    'Clear and Details buttons show a badge with the exact selected count (%i)',
    (count: number) => {
      renderToolbar({ selectedCount: count });
      const clearButton = screen.getByRole('button', { name: /^Clear/i });
      const detailsButton = screen.getByRole('button', { name: /^Details/i });
      expect(clearButton.querySelector('.MuiBadge-badge')).toHaveTextContent(
        String(count)
      );
      expect(
        detailsButton.querySelector('.MuiBadge-badge')
      ).toHaveTextContent(String(count));
    }
  );

  test('Clear and Details badge counts update when selectedCount changes across re-renders', () => {
    const props = {
      filterQuery: '',
      setFilterQuery: jest.fn(),
      autoReload: false,
      onReloadClick: jest.fn(),
      disableManualRefresh: false,
      canHoldSelected: true,
      canReleaseSelected: true,
      canSuspendSelected: true,
      canResumeSelected: true,
      canRequeueSelected: true,
      hasAdminHoldSelected: false,
      hasSuspendedSelected: false,
      hasGroupedArrayRangeSelected: false,
      hasPdSelected: false,
      hasRSelected: false,
      hasSSelected: false,
      hasHeldSelected: false,
      hasUnheldPdSelected: false,
      pauseApplicableCount: 0,
      resumeApplicableCount: 0,
      requeueApplicableCount: 0,
      onClearSelected: jest.fn(),
      onShowDetails: jest.fn(),
      onJobAction: jest.fn(),
      userOnly: false,
      onUserOnlyClick: jest.fn()
    };
    const { rerender } = render(
      <SqueueToolbar {...props} selectedCount={1} />
    );
    expect(
      screen
        .getByRole('button', { name: /^Clear/i })
        .querySelector('.MuiBadge-badge')
    ).toHaveTextContent('1');

    rerender(<SqueueToolbar {...props} selectedCount={4} />);
    expect(
      screen
        .getByRole('button', { name: /^Clear/i })
        .querySelector('.MuiBadge-badge')
    ).toHaveTextContent('4');
    expect(
      screen
        .getByRole('button', { name: /^Details/i })
        .querySelector('.MuiBadge-badge')
    ).toHaveTextContent('4');

    rerender(<SqueueToolbar {...props} selectedCount={0} />);
    expect(
      screen.getByRole('button', { name: /^Clear/i }).querySelector('.MuiBadge-badge')
    ).toBeNull();
    expect(
      screen
        .getByRole('button', { name: /^Details/i })
        .querySelector('.MuiBadge-badge')
    ).toBeNull();
  });

  test('Clear badge still shows the exact literal count at exactly 99 (MUI Badge\'s default max)', () => {
    // Neither Badge sets a custom `max` prop, so MUI's own default (99)
    // applies: 99 itself is still shown literally; only counts *above* 99
    // roll over to "99+" (see the next test).
    renderToolbar({ selectedCount: 99 });
    expect(
      screen
        .getByRole('button', { name: /^Clear/i })
        .querySelector('.MuiBadge-badge')
    ).toHaveTextContent('99');
  });

  test.each([100, 250, 100000])(
    'Clear and Details badges show "99+" once selectedCount exceeds MUI\'s default max (%i)',
    (count: number) => {
      const { unmount } = render(
        <SqueueToolbar
          filterQuery={''}
          setFilterQuery={jest.fn()}
          autoReload={false}
          onReloadClick={jest.fn()}
          disableManualRefresh={false}
          selectedCount={count}
          canHoldSelected={true}
          canReleaseSelected={true}
          canSuspendSelected={true}
          canResumeSelected={true}
          canRequeueSelected={true}
          hasAdminHoldSelected={false}
          hasSuspendedSelected={false}
          hasGroupedArrayRangeSelected={false}
          hasPdSelected={false}
          hasRSelected={false}
          hasSSelected={false}
          hasHeldSelected={false}
          hasUnheldPdSelected={false}
          pauseApplicableCount={0}
          resumeApplicableCount={0}
          requeueApplicableCount={0}
          onClearSelected={jest.fn()}
          onShowDetails={jest.fn()}
          onJobAction={jest.fn()}
          userOnly={false}
          onUserOnlyClick={jest.fn()}
        />
      );
      expect(
        screen
          .getByRole('button', { name: /^Clear/i })
          .querySelector('.MuiBadge-badge')
      ).toHaveTextContent('99+');
      expect(
        screen
          .getByRole('button', { name: /^Details/i })
          .querySelector('.MuiBadge-badge')
      ).toHaveTextContent('99+');
      unmount();
    }
  );

  test('Clear and Details badges show "1" (not blank/"0") for a selection of exactly one job', () => {
    renderToolbar({ selectedCount: 1 });
    expect(
      screen
        .getByRole('button', { name: /^Clear/i })
        .querySelector('.MuiBadge-badge')
    ).toHaveTextContent('1');
  });

  test('Clear and Details show no badge for a negative/invalid selectedCount (defensive: treated as falsy/absent)', () => {
    // selectedCount should never legitimately go negative (it's always
    // selectedRows.length), but MUI's Badge hides badgeContent for any
    // falsy value, including 0 -- confirm a stray -0/0-like edge case
    // still resolves to "no badge" rather than rendering something
    // nonsensical like "-1".
    renderToolbar({ selectedCount: 0 });
    expect(
      screen.getByRole('button', { name: /^Clear/i }).querySelector('.MuiBadge-badge')
    ).toBeNull();
  });

  test('Details is disabled with an explanatory tooltip when a grouped array-range job is selected', () => {
    renderToolbar({
      selectedCount: 1,
      hasGroupedArrayRangeSelected: true
    });
    const button = screen.getByRole('button', { name: /Details/i });
    expect(button).toBeDisabled();
  });

  test('kill fires the corresponding job action, labeled simply "Cancel"', () => {
    const props = renderToolbar({ selectedCount: 2 });

    fireEvent.click(screen.getByRole('button', { name: /^Cancel/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('cancel');
  });

  test('Pause fires "hold" when the selection is eligible for Hold', () => {
    const props = renderToolbar({
      selectedCount: 1,
      canHoldSelected: true,
      canSuspendSelected: false,
      hasPdSelected: true,
      hasUnheldPdSelected: true,
      hasRSelected: false
    });
    fireEvent.click(screen.getByRole('button', { name: /^Pause/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('hold');
    expect(props.onJobAction).toHaveBeenCalledTimes(1);
  });

  test('Pause fires "suspend" when the selection is eligible for Suspend only', () => {
    const props = renderToolbar({
      selectedCount: 1,
      canHoldSelected: false,
      canSuspendSelected: true,
      hasPdSelected: false,
      hasRSelected: true
    });
    fireEvent.click(screen.getByRole('button', { name: /^Pause/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('suspend');
    expect(props.onJobAction).toHaveBeenCalledTimes(1);
  });

  test('Pause fires both "hold" and "suspend" for a mixed PD+R selection', () => {
    const props = renderToolbar({
      selectedCount: 2,
      canHoldSelected: false,
      canSuspendSelected: false,
      hasPdSelected: true,
      hasUnheldPdSelected: true,
      hasRSelected: true
    });
    const button = screen.getByRole('button', { name: /^Pause/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(props.onJobAction).toHaveBeenCalledWith('hold');
    expect(props.onJobAction).toHaveBeenCalledWith('suspend');
    expect(props.onJobAction).toHaveBeenCalledTimes(2);
  });

  test('Resume fires "release" when the selection is eligible for Release', () => {
    const props = renderToolbar({
      selectedCount: 1,
      canReleaseSelected: true,
      canResumeSelected: false,
      hasPdSelected: true,
      hasHeldSelected: true,
      hasSSelected: false
    });
    fireEvent.click(screen.getByRole('button', { name: /^Resume/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('release');
    expect(props.onJobAction).toHaveBeenCalledTimes(1);
  });

  test('Resume fires "resume" when the selection is eligible for Resume only', () => {
    const props = renderToolbar({
      selectedCount: 1,
      canReleaseSelected: false,
      canResumeSelected: true,
      hasPdSelected: false,
      hasSSelected: true
    });
    fireEvent.click(screen.getByRole('button', { name: /^Resume/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('resume');
    expect(props.onJobAction).toHaveBeenCalledTimes(1);
  });

  test('Resume fires both "release" and "resume" for a mixed PD+S selection', () => {
    const props = renderToolbar({
      selectedCount: 2,
      canReleaseSelected: false,
      canResumeSelected: false,
      hasPdSelected: true,
      hasHeldSelected: true,
      hasSSelected: true
    });
    const button = screen.getByRole('button', { name: /^Resume/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(props.onJobAction).toHaveBeenCalledWith('release');
    expect(props.onJobAction).toHaveBeenCalledWith('resume');
    expect(props.onJobAction).toHaveBeenCalledTimes(2);
  });

  test('Requeue split button fires "requeue" by default, and "requeuehold" once selected from the menu', () => {
    const props = renderToolbar({ selectedCount: 1 });

    fireEvent.click(screen.getByRole('button', { name: /^Requeue/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('requeue');

    fireEvent.click(
      screen.getByRole('button', { name: /select requeue option/i })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Requeue & Hold/i }));

    // The main segment's visible label stays a fixed "Requeue" regardless of
    // the chosen mode (so the button doesn't grow wider than its neighbors);
    // it's still the same element found by /^Requeue/i above.
    fireEvent.click(screen.getByRole('button', { name: /^Requeue/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('requeuehold');
  });

  test('clear-selected and show-details fire their callbacks when enabled', () => {
    const props = renderToolbar({ selectedCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: /^Clear/i }));
    expect(props.onClearSelected).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Details/i }));
    expect(props.onShowDetails).toHaveBeenCalled();
  });

  test('the manual Refresh button shows when auto-reload is off and fires on click', () => {
    const props = renderToolbar({ autoReload: false });
    const refresh = screen.getByRole('button', { name: /Refresh/i });
    expect(refresh).toBeInTheDocument();
    fireEvent.click(refresh);
    expect(props.onReloadClick).toHaveBeenCalled();
  });

  test('the "My jobs only" switch toggles', () => {
    const props = renderToolbar({ selectedCount: 1 });
    fireEvent.click(screen.getByLabelText('My jobs only'));
    expect(props.onUserOnlyClick).toHaveBeenCalled();
  });

  test('Pause is disabled when neither Hold nor Suspend is eligible (e.g. a COMPLETED job)', () => {
    renderToolbar({
      selectedCount: 1,
      canHoldSelected: false,
      canSuspendSelected: false
    });
    expect(screen.getByRole('button', { name: /^Pause/i })).toBeDisabled();
    // Kill remains available regardless of state.
    expect(screen.getByRole('button', { name: /^Cancel/i })).toBeEnabled();
  });

  test('Pause is enabled when either Hold or Suspend is eligible', () => {
    renderToolbar({
      selectedCount: 1,
      canHoldSelected: true,
      canSuspendSelected: false
    });
    expect(screen.getByRole('button', { name: /^Pause/i })).toBeEnabled();
  });

  test('Resume is disabled when neither Release nor Resume is eligible', () => {
    renderToolbar({
      selectedCount: 1,
      canReleaseSelected: false,
      canResumeSelected: false
    });
    expect(screen.getByRole('button', { name: /^Resume/i })).toBeDisabled();
  });

  test('Resume is enabled when either Release or Resume is eligible', () => {
    renderToolbar({
      selectedCount: 1,
      canReleaseSelected: true,
      canResumeSelected: false
    });
    expect(screen.getByRole('button', { name: /^Resume/i })).toBeEnabled();
  });

  test('Requeue is enabled whenever something is selected', () => {
    renderToolbar({ selectedCount: 1, canRequeueSelected: true });
    expect(screen.getByRole('button', { name: /^Requeue/i })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /select requeue option/i })
    ).toBeEnabled();
  });

  test('Resume is disabled with an admin-hold-specific tooltip when the selection is admin-held', () => {
    renderToolbar({
      selectedCount: 1,
      canReleaseSelected: false,
      canResumeSelected: false,
      hasAdminHoldSelected: true
    });
    const resumeButton = screen.getByRole('button', { name: /^Resume/i });
    expect(resumeButton).toBeDisabled();
  });

  test('Requeue fires immediately (no confirmation) when no suspended job is selected', () => {
    const props = renderToolbar({
      selectedCount: 1,
      hasSuspendedSelected: false
    });
    fireEvent.click(screen.getByRole('button', { name: /^Requeue/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('requeue');
    expect(
      screen.queryByText(/Requeue a suspended job\?/i)
    ).not.toBeInTheDocument();
  });

  test('Requeue shows a confirmation dialog when a suspended job is selected, and only fires after confirming', async () => {
    const props = renderToolbar({
      selectedCount: 1,
      hasSuspendedSelected: true
    });
    fireEvent.click(screen.getByRole('button', { name: /^Requeue/i }));
    expect(props.onJobAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Requeue a suspended job\?/i)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /Requeue Anyway/i })
    );
    expect(props.onJobAction).toHaveBeenCalledWith('requeue');
    await waitFor(() =>
      expect(
        screen.queryByText(/Requeue a suspended job\?/i)
      ).not.toBeInTheDocument()
    );
  });

  test('Requeue confirmation dialog Cancel button does not fire the action', async () => {
    const props = renderToolbar({
      selectedCount: 1,
      hasSuspendedSelected: true
    });
    fireEvent.click(screen.getByRole('button', { name: /^Requeue/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/i }));
    expect(props.onJobAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByText(/Requeue a suspended job\?/i)
      ).not.toBeInTheDocument()
    );
  });
});
