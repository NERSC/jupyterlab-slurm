import {
  createDisplayColumnsFromServer,
  isHeldReason
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
    test('matches the NERSC/standard held reason', () => {
      expect(isHeldReason('(JobHeldUser)')).toBe(true);
      expect(isHeldReason('JobHeldUser')).toBe(true);
    });

    test('does not match other reasons or non-strings', () => {
      expect(isHeldReason('(Priority)')).toBe(false);
      expect(isHeldReason('node001')).toBe(false);
      expect(isHeldReason(undefined)).toBe(false);
      expect(isHeldReason(null)).toBe(false);
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
  });
});
