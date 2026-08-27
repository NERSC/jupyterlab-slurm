import {
  joinAndNormalizePosix,
  isPathLike,
  resolveForActions
} from '../../src/utils/paths';

describe('paths', () => {
  describe('joinAndNormalizePosix', () => {
    test('should return absolute path as-is', () => {
      expect(joinAndNormalizePosix('/home/user', '/abs/path')).toBe(
        '/abs/path'
      );
    });

    test('should return home shortcut as-is', () => {
      expect(joinAndNormalizePosix('/home/user', '~/logs')).toBe('~/logs');
    });

    test('should join relative path with workdir', () => {
      expect(joinAndNormalizePosix('/home/user', 'logs/job.out')).toBe(
        '/home/user/logs/job.out'
      );
    });

    test('should normalize .. and . segments', () => {
      expect(
        joinAndNormalizePosix('/home/user/project', '../other/./file')
      ).toBe('/home/user/other/file');
      expect(joinAndNormalizePosix('/a/b/c', '../../d')).toBe('/a/d');
    });

    test('should handle empty or missing paths', () => {
      expect(joinAndNormalizePosix('/work', '')).toBe('');
      expect(joinAndNormalizePosix('', 'rel/path')).toBe('rel/path');
    });
  });

  describe('isPathLike', () => {
    test('should identify absolute paths', () => {
      expect(isPathLike('/path/to/file')).toBe(true);
    });

    test('should identify home paths', () => {
      expect(isPathLike('~/file')).toBe(true);
    });

    test('should identify paths with extensions', () => {
      expect(isPathLike('some/file.txt')).toBe(true);
      expect(isPathLike('job.out')).toBe(true);
    });

    test('should reject non-path strings', () => {
      expect(isPathLike('not a path')).toBe(false);
      expect(isPathLike('')).toBe(false);
      expect(isPathLike(null)).toBe(false);
    });
  });

  describe('resolveForActions', () => {
    test('should resolve relative path against workdir', () => {
      expect(resolveForActions('job.log', '/scratch/user')).toBe(
        '/scratch/user/job.log'
      );
    });

    test('should return undefined if no path provided', () => {
      expect(resolveForActions(undefined, '/work')).toBeUndefined();
    });
  });
});
