import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { SqueueToolbar } from '../../src/components/SqueueToolbar';

function renderToolbar(overrides: Partial<any> = {}) {
  const props = {
    filterQuery: '',
    setFilterQuery: jest.fn(),
    autoReload: false,
    onReloadClick: jest.fn(),
    disableManualRefresh: false,
    selectedCount: 0,
    onClearSelected: jest.fn(),
    onShowDetails: jest.fn(),
    onJobAction: jest.fn(),
    userOnly: false,
    onUserOnlyClick: jest.fn(),
    showSelectedOnly: false,
    onShowSelectedOnlyClick: jest.fn(),
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
    expect(screen.getByRole('button', { name: /Kill Job/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Hold/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Release/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Show details/i })
    ).toBeDisabled();
  });

  test('kill/hold/release fire the corresponding job action', () => {
    const props = renderToolbar({ selectedCount: 2 });

    fireEvent.click(screen.getByRole('button', { name: /Kill Job/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('kill');

    fireEvent.click(screen.getByRole('button', { name: /Hold/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('hold');

    fireEvent.click(screen.getByRole('button', { name: /Release/i }));
    expect(props.onJobAction).toHaveBeenCalledWith('release');
  });

  test('clear-selected and show-details fire their callbacks when enabled', () => {
    const props = renderToolbar({ selectedCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: /Clear Selected/i }));
    expect(props.onClearSelected).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Show details/i }));
    expect(props.onShowDetails).toHaveBeenCalled();
  });

  test('the manual Refresh button shows when auto-reload is off and fires on click', () => {
    const props = renderToolbar({ autoReload: false });
    const refresh = screen.getByRole('button', { name: /Refresh/i });
    expect(refresh).toBeInTheDocument();
    fireEvent.click(refresh);
    expect(props.onReloadClick).toHaveBeenCalled();
  });

  test('the "My jobs only" and "Selected only" switches toggle', () => {
    const props = renderToolbar({ selectedCount: 1 });
    fireEvent.click(screen.getByLabelText('My jobs only'));
    expect(props.onUserOnlyClick).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Selected only'));
    expect(props.onShowSelectedOnlyClick).toHaveBeenCalled();
  });

  test('"Selected only" switch is disabled without a selection', () => {
    renderToolbar({ selectedCount: 0 });
    expect(screen.getByLabelText('Selected only')).toBeDisabled();
  });
});
