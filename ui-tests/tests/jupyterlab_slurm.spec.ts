import { expect, test } from '@jupyterlab/galata';

/**
 * Don't load JupyterLab webpage before running the tests.
 * This is required to ensure we capture all log messages.
 */
test.use({ autoGoto: false });

test('should emit an activation console message', async ({ page }) => {
  const logs: string[] = [];

  page.on('console', message => {
    logs.push(message.text());
  });

  await page.goto();

  expect(
    logs.filter(
      s => s === 'JupyterLab extension jupyterlab-slurm is activated!'
    )
  ).toHaveLength(1);
});

// Verify the Slurm queue grid renders the mocked rows and the Job ID
// column header is sortable (toggles its sort indicator on click).
//
// NOTE: this intentionally does NOT assert on the resulting row order.
// While writing this test we found that clicking a column header updates
// the header's `aria-sort` state but never actually reorders the grid's
// rows (reproduced even in a clean venv with only jupyterlab_slurm
// installed, for both this custom JOBID comparator and a plain default
// column) -- a real, pre-existing AG Grid integration bug in
// `SqueueDataTable.tsx`, unrelated to the CI/build issues this test file
// otherwise exists to guard against. Tracked separately; asserting on row
// order here would just make this test permanently red until that's
// fixed.
test('Squeue grid renders array job IDs and toggles column sort state', async ({
  page
}) => {
  const rows: string[][] = [
    // JOBID, PARTITION, NAME, USER, ST, TIME, NODES, NODELIST(REASON)
    ['1002', 'batch', 'jobB', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1001_10', 'batch', 'jobA10', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1001_[3-5]', 'batch', 'jobAarr', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1001_2', 'batch', 'jobA2', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1001', 'batch', 'jobA', 'user', 'PD', '0:00', '1', '(Priority)'],
    [
      '1002_[2,4-6]',
      'batch',
      'jobBarr',
      'user',
      'PD',
      '0:00',
      '1',
      '(Priority)'
    ]
  ];

  // Matches the envelope produced by `SqueueHandler.run_command` in
  // jupyterlab_slurm/handlers.py (`{success, ..., data: {rows, columns}}`).
  const payload = {
    success: true,
    responseMessage: 'Success',
    errorMessage: null,
    exitCode: 0,
    data: {
      rows,
      columns: [
        'JOBID',
        'PARTITION',
        'NAME',
        'USER',
        'ST',
        'TIME',
        'NODES',
        'NODELIST(REASON)'
      ]
    }
  };

  // ServerConnection.makeRequest appends a cache-busting query string, so
  // the pattern must allow for extra (query) characters after "squeue".
  await page.route('**/jupyterlab_slurm/squeue?*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  });

  await page.goto();

  // Open the Slurm Dashboard widget (it isn't opened automatically on load)
  // by clicking its card in the Launcher.
  await page.click('.jp-Launcher-content >> text=Slurm Dashboard');

  // "My jobs only" defaults to on and filters by the real server user, which
  // won't match the mocked rows' USER field, so switch it off to see all rows.
  const myJobsOnlyToggle = page.getByRole('checkbox', {
    name: 'My jobs only'
  });
  if (await myJobsOnlyToggle.isChecked()) {
    await myJobsOnlyToggle.click();
  }

  // Navigate to the Jobs tab (it is first and active by default in the widget)
  // Wait for the grid to render the mocked rows
  const jobIdCells = page.locator('.ag-center-cols-container [col-id="JOBID"]');
  await expect(jobIdCells).toHaveCount(rows.length);

  // Click the Job ID header and verify it's sortable, i.e. AG Grid's
  // sort-state cascade (none -> asc -> desc -> none) responds to clicks by
  // toggling the header's `aria-sort` attribute. See the note above the
  // test declaration for why the resulting row order isn't asserted here.
  const jobIdHeader = page.locator('.ag-header-cell[col-id="JOBID"]');

  await jobIdHeader.click();
  await expect(jobIdHeader).toHaveAttribute('aria-sort', 'ascending');

  await jobIdHeader.click();
  await expect(jobIdHeader).toHaveAttribute('aria-sort', 'descending');
});
