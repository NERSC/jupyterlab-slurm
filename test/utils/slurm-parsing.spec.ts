import { parseTimeInSeconds, parseJobID } from '../../src/utils/slurm-parsing';

describe('slurm-parsing', () => {
  describe('parseTimeInSeconds', () => {
    test('should parse HH:MM:SS', () => {
      expect(parseTimeInSeconds('01:02:03')).toBe(3600 + 120 + 3);
      expect(parseTimeInSeconds('00:00:10')).toBe(10);
    });

    test('should parse DD-HH:MM:SS', () => {
      expect(parseTimeInSeconds('1-00:00:00')).toBe(86400);
      expect(parseTimeInSeconds('2-01:02:03')).toBe(2 * 86400 + 3600 + 120 + 3);
    });

    test('should parse MM:SS', () => {
      expect(parseTimeInSeconds('05:30')).toBe(330);
    });

    test('should handle unexpected formats gracefully', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(parseTimeInSeconds('invalid')).toBe(0);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('parseJobID', () => {
    const FACTOR = 1_000_000;

    test('should parse plain job IDs', () => {
      expect(parseJobID('1234')).toBe(1234 * FACTOR);
    });

    test('should parse array element IDs', () => {
      // 1234_5 -> base 1234, suffix 5 -> offset 6
      expect(parseJobID('1234_5')).toBe(1234 * FACTOR + 6);
    });

    test('should parse array short form IDs', () => {
      // 1234_[1,3-5,10] -> base 1234, min sub 1 -> offset 2
      expect(parseJobID('1234_[1,3-5,10]')).toBe(1234 * FACTOR + 2);
      // 1234_[10-12] -> base 1234, min sub 10 -> offset 11
      expect(parseJobID('1234_[10-12]')).toBe(1234 * FACTOR + 11);
    });

    test('should handle malformed IDs', () => {
      expect(parseJobID('')).toBe(Number.MAX_SAFE_INTEGER);
      expect(parseJobID('not_a_number')).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('should sort plain job before array jobs of same base', () => {
      const plain = parseJobID('1000');
      const array = parseJobID('1000_1');
      const arrayRange = parseJobID('1000_[0-5]');

      expect(plain).toBeLessThan(arrayRange); // 1000*F + 0  < 1000*F + 1
      expect(arrayRange).toBeLessThan(array); // 1000*F + 1 < 1000*F + 2
    });
  });
});
