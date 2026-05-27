import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

function walkSourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      return walkSourceFiles(path);
    }

    if (!stats.isFile()) {
      return [];
    }

    const extension = path.slice(path.lastIndexOf('.'));
    return SOURCE_EXTENSIONS.has(extension) ? [path] : [];
  });
}

function rightAnchoredDialogOpenTags(source) {
  return source.match(/<dialog\b[\s\S]*?>/g)
    ?.filter((openingTag) => (
      openingTag.includes('fixed inset-y-0')
      && openingTag.includes('right-0')
    )) || [];
}

describe('right-anchored native dialogs', () => {
  it('clears the browser default left inset so drawers anchor to the right', () => {
    const offenders = [];

    for (const path of walkSourceFiles(SOURCE_ROOT)) {
      const source = readFileSync(path, 'utf8');

      for (const openingTag of rightAnchoredDialogOpenTags(source)) {
        if (!openingTag.includes('left-auto')) {
          offenders.push(relative(SOURCE_ROOT, path));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
