import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { organizeCases } from '../src/case/forensicOrganizer';

describe('organizeCases', () => {
  it('sorts and renames files into case folders', async () => {
    const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), 'in-'));
    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), 'out-'));

    await fs.writeFile(path.join(tmpIn, 'CASE-1000_report.txt'), 'a');
    await fs.writeFile(path.join(tmpIn, 'CASE-1000_photo.jpg'), 'b');
    await fs.writeFile(path.join(tmpIn, 'MISC-2000_note.txt'), 'c');

    const results = await organizeCases(tmpIn, tmpOut);

    expect(results.length).toBe(3);

    const caseDir = path.join(tmpOut, 'case-1000');
    const miscDir = path.join(tmpOut, 'misc-2000');
    const uncategorizedDir = path.join(tmpOut, 'uncategorized');

    const caseFiles = await fs.readdir(caseDir);
    const miscFiles = await fs.readdir(miscDir);
    const uncategorizedExists = await fs
      .access(uncategorizedDir)
      .then(() => true)
      .catch(() => false);

    expect(caseFiles.sort()).toEqual(['doc_1.txt', 'doc_2.jpg'].sort());
    expect(miscFiles).toEqual(['doc_1.txt']);
    expect(uncategorizedExists).toBe(false);
  });
});
