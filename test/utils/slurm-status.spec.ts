import { JOB_STATUS_CODES } from '../../src/utils/slurm-status';

describe('slurm-status JOB_STATUS_CODES', () => {
  test('contains the common NERSC/standard state codes', () => {
    // These are the codes the queue ST column and status utilities rely on.
    const expected = ['R', 'PD', 'CD', 'CG', 'F', 'TO', 'CA', 'S'];
    for (const code of expected) {
      expect(JOB_STATUS_CODES[code]).toBeDefined();
    }
  });

  test('every entry exposes a non-empty name and description', () => {
    const entries = Object.entries(JOB_STATUS_CODES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [code, value] of entries) {
      expect(typeof value.name).toBe('string');
      expect(value.name.length).toBeGreaterThan(0);
      expect(typeof value.description).toBe('string');
      expect(value.description.length).toBeGreaterThan(0);
      // The code itself should be a short uppercase token.
      expect(code).toMatch(/^[A-Z]+$/);
    }
  });

  test('maps key codes to their human-readable names', () => {
    expect(JOB_STATUS_CODES['R'].name).toBe('RUNNING');
    expect(JOB_STATUS_CODES['PD'].name).toBe('PENDING');
    expect(JOB_STATUS_CODES['CD'].name).toBe('COMPLETED');
    expect(JOB_STATUS_CODES['F'].name).toBe('FAILED');
    expect(JOB_STATUS_CODES['TO'].name).toBe('TIMEOUT');
    expect(JOB_STATUS_CODES['CA'].name).toBe('CANCELLED');
  });

  test('does not define a distinct held (H) code (NERSC models holds as PD)', () => {
    // A user hold is a PENDING job with Reason=(JobHeldUser); there is no `H`.
    expect(JOB_STATUS_CODES['H']).toBeUndefined();
  });
});
