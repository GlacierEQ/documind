import fs from 'fs/promises';
import path from 'path';

export interface OrganizedResult {
  original: string;
  newPath: string;
}

function detectCaseId(fileName: string): string | null {
  const match = fileName.match(/[A-Z]+-[0-9]{4}/);
  return match ? match[0].toLowerCase() : null;
}

export async function organizeCases(
  inputDir: string,
  outputDir: string
): Promise<OrganizedResult[]> {
  const entries = await fs.readdir(inputDir);
  const results: OrganizedResult[] = [];
  const caseIndexMap = new Map<string, number>();

  for (const entry of entries) {
    const filePath = path.join(inputDir, entry);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;

    const caseId = detectCaseId(entry) || 'uncategorized';
    const caseDir = path.join(outputDir, caseId);
    await fs.mkdir(caseDir, { recursive: true });
    const index = (caseIndexMap.get(caseId) || 0) + 1;
    caseIndexMap.set(caseId, index);
    const ext = path.extname(entry).toLowerCase();
    const newName = `doc_${index}${ext}`;
    const destPath = path.join(caseDir, newName);
    await fs.copyFile(filePath, destPath);
    results.push({ original: filePath, newPath: destPath });
  }

  return results;
}
