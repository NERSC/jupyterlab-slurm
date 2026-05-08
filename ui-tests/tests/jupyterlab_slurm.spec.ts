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

// Verify custom Job ID sorting comparator in the Slurm queue grid
// We intercept the backend squeue API to return a deterministic dataset
// that exercises plain IDs, single array elements, and bracket short forms.
test('Squeue grid sorts Job IDs numerically with arrays', async ({ page }) => {
  const rows: string[][] = [
    // JOBID, PARTITION, NAME, USER, ST, TIME, NODES, NODELIST(REASON)
    ['1002', 'batch', 'jobB', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1001_10', 'batch', 'jobA10', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1001_[3-5]', 'batch', 'jobAarr', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1001_2', 'batch', 'jobA2', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1001', 'batch', 'jobA', 'user', 'PD', '0:00', '1', '(Priority)'],
    ['1002_[2,4-6]', 'batch', 'jobBarr', 'user', 'PD', '0:00', '1', '(Priority)']
  ];

  const payload = {
    squeue: { stdout: '', stderr: '', returncode: 0 },
    data: rows
  };

  await page.route('**/jupyterlab_slurm/squeue', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  });

  await page.goto();

  // Navigate to the Slurm Queue tab (it is first and active by default in the widget)
  // Wait for the grid to render the mocked rows
  const jobIdCells = page.locator('.ag-center-cols-container [col-id="JOBID"]');
  await expect(jobIdCells).toHaveCount(rows.length);

  // Click the Job ID header to sort ascending
  const jobIdHeader = page.locator('.ag-header-cell[col-id="JOBID"]');
  await jobIdHeader.click(); // first click (sets sort, typically asc)
  // Some themes toggle through none->asc->desc; enforce asc by clicking once more if needed
  // Collect the order and verify
  const ascExpected = ['1001', '1001_2', '1001_[3-5]', '1001_10', '1002', '1002_[2,4-6]'];

  // Wait until the first cell matches the expected asc order start to avoid race with rendering
  await page.waitForTimeout(100); // small settle time for ag-Grid sort
  const ascValues = await jobIdCells.allInnerTexts();

  // If the first value isn't from the expected ascending set, click again to advance sort state
  if (ascValues[0] !== ascExpected[0]) {
    await jobIdHeader.click();
  }

  // Re-read values after ensuring asc
  const ascSorted = await jobIdCells.allInnerTexts();
  expect(ascSorted).toEqual(ascExpected);

  // Click again to sort descending and verify reverse order
  await jobIdHeader.click();
  await page.waitForTimeout(100);
  const descValues = await jobIdCells.allInnerTexts();
  expect(descValues).toEqual([...ascExpected].reverse());
});
