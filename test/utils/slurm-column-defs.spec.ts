import {
  createDisplayColumnsFromServer,
  isHeldReason,
  isAdminHeldReason
} from '../../src/utils/slurm-column-defs';

const SERVER_COLUMNS = [
  'JOBID',
  'PARTITION',
  'NAME',
  'USER',
  'ST',
  'TIME',
  'NODES',
  'NODELIST(REASON)'
];

function getStatusColumn(): any {
  const cols = createDisplayColumnsFromServer(SERVER_COLUMNS, {}, {});
  const st = cols.find((c: any) => c.field === 'ST');
  expect(st).toBeDefined();
  return st;
}

describe('slurm-column-defs', () => {
  describe('isHeldReason', () => {
    test('matches the NERSC/standard user-held reason', () => {
      expect(isHeldReason('(JobHeldUser)')).toBe(true);
      expect(isHeldReason('JobHeldUser')).toBe(true);
    });

    test('matches an admin-held reason too (e.g. from a plain Requeue on a SUSPENDED job)', () => {
      expect(isHeldReason('(JobHeldAdmin)')).toBe(true);
      expect(isHeldReason('JobHeldAdmin')).toBe(true);
    });

    test('matches the literal reason real Slurm sets for Requeue & Hold ("job requeued in held state"), confirmed live and distinct from JobHeldUser/JobHeldAdmin', () => {
      expect(isHeldReason('(job requeued in held state)')).toBe(true);
      expect(isHeldReason('job_requeued_in_held_state')).toBe(true);
    });

    test('does not match other reasons or non-strings', () => {
      expect(isHeldReason('(Priority)')).toBe(false);
      expect(isHeldReason('node001')).toBe(false);
      expect(isHeldReason(undefined)).toBe(false);
      expect(isHeldReason(null)).toBe(false);
    });
  });

  describe('isAdminHeldReason', () => {
    test('matches only the admin-held reason', () => {
      expect(isAdminHeldReason('(JobHeldAdmin)')).toBe(true);
      expect(isAdminHeldReason('(JobHeldUser)')).toBe(false);
      expect(isAdminHeldReason('(Priority)')).toBe(false);
      expect(isAdminHeldReason(undefined)).toBe(false);
    });

    test('does not treat requeuehold\'s "job requeued in held state" reason as admin-only (confirmed live: owner can release it)', () => {
      expect(isAdminHeldReason('(job requeued in held state)')).toBe(false);
    });
  });

  describe('ST column value formatting', () => {
    test('renders a plain pending job as PENDING', () => {
      const st = getStatusColumn();
      const out = st.valueFormatter({
        value: 'PD',
        data: { 'NODELIST(REASON)': '(Priority)' }
      });
      expect(out).toBe('PENDING');
    });

    test('renders a user-held pending job as PENDING (Held)', () => {
      const st = getStatusColumn();
      const out = st.valueFormatter({
        value: 'PD',
        data: { 'NODELIST(REASON)': '(JobHeldUser)' }
      });
      expect(out).toBe('PENDING (Held)');
    });

    test('renders an admin-held pending job as PENDING (Held) too (e.g. after a plain Requeue on a SUSPENDED job)', () => {
      const st = getStatusColumn();
      const out = st.valueFormatter({
        value: 'PD',
        data: { 'NODELIST(REASON)': '(JobHeldAdmin)' }
      });
      expect(out).toBe('PENDING (Held)');
    });

    test('renders a Requeue & Hold job (real reason "job requeued in held state") as PENDING (Held)', () => {
      const st = getStatusColumn();
      const out = st.valueFormatter({
        value: 'PD',
        data: { 'NODELIST(REASON)': '(job requeued in held state)' }
      });
      expect(out).toBe('PENDING (Held)');
    });

    test('renders a running job as RUNNING', () => {
      const st = getStatusColumn();
      const out = st.valueFormatter({
        value: 'R',
        data: { 'NODELIST(REASON)': 'node001' }
      });
      expect(out).toBe('RUNNING');
    });

    test('quick filter text includes Held for a held job', () => {
      const st = getStatusColumn();
      const text = st.getQuickFilterText({
        value: 'PD',
        data: { 'NODELIST(REASON)': '(JobHeldUser)' }
      });
      expect(text).toContain('Held');
    });

    test('tooltip notes when a pending job is held by the user', () => {
      const st = getStatusColumn();
      const tip = st.tooltipValueGetter({
        value: 'PD',
        data: { 'NODELIST(REASON)': '(JobHeldUser)' }
      });
      expect(tip).toContain('Held by user');
    });

    test('tooltip notes when a pending job is held by an administrator', () => {
      const st = getStatusColumn();
      const tip = st.tooltipValueGetter({
        value: 'PD',
        data: { 'NODELIST(REASON)': '(JobHeldAdmin)' }
      });
      expect(tip).toContain('Held by an administrator');
    });

    test('filterValueGetter returns the displayed text (e.g. PENDING), not the raw code (e.g. PD), so the column filter matches what the user sees', () => {
      const st = getStatusColumn();
      const filtered = st.filterValueGetter({
        data: { ST: 'PD', 'NODELIST(REASON)': '(Priority)' }
      });
      expect(filtered).toBe('PENDING');
    });

    test('filterValueGetter also reflects the (Held) suffix for a held pending job', () => {
      const st = getStatusColumn();
      const filtered = st.filterValueGetter({
        data: { ST: 'PD', 'NODELIST(REASON)': '(JobHeldUser)' }
      });
      expect(filtered).toBe('PENDING (Held)');
    });
  });
});
