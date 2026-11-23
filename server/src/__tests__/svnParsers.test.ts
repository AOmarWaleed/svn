import { describe, expect, it } from 'vitest';
import {
  parseMergeinfoEligible,
  parseMergeOutput,
  parseSvnInfoXml,
  parseSvnLogXml,
  parseSvnStatusXml,
} from '../utils/svnParsers';

describe('svnParsers', () => {
  it('parses svn info --xml including tree-conflict metadata', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry kind="file" path="oldReport.ts" revision="142">
    <url>https://svn.company.local/repos/erp/trunk/src/oldReport.ts</url>
    <relative-url>^/trunk/src/oldReport.ts</relative-url>
    <repository>
      <root>https://svn.company.local/repos/erp</root>
    </repository>
    <commit revision="138">
      <author>ahmed</author>
      <date>2026-11-20T10:00:00.000000Z</date>
    </commit>
    <tree-conflict victim="oldReport.ts" kind="file" operation="merge" action="delete" reason="edited" />
  </entry>
</info>`;

    const info = parseSvnInfoXml(xml);
    expect(info.url).toBe('https://svn.company.local/repos/erp/trunk/src/oldReport.ts');
    expect(info.relativeUrl).toBe('^/trunk/src/oldReport.ts');
    expect(info.repositoryRoot).toBe('https://svn.company.local/repos/erp');
    expect(info.revision).toBe(142);
    expect(info.lastChangedRev).toBe(138);
    expect(info.lastChangedAuthor).toBe('ahmed');
    expect(info.treeConflictDescription).toContain('merge');
    expect(info.treeConflictDescription).toContain('delete');
  });

  it('parses svn status --xml with modified, added, unversioned, conflicted, tree-conflicted, and remote incoming', () => {
    const wcRoot = 'D:\\CompanySVN\\erp-master';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src\\a.ts">
      <wc-status item="modified" props="none" />
    </entry>
    <entry path="src\\b.ts">
      <wc-status item="added" props="none" />
    </entry>
    <entry path="src\\c.ts">
      <wc-status item="conflicted" props="none" />
    </entry>
    <entry path="src\\d.ts">
      <wc-status item="normal" props="none" tree-conflicted="true" />
    </entry>
    <entry path="src\\e.ts">
      <wc-status item="normal" props="none" />
      <repos-status item="modified" props="none" />
    </entry>
    <entry path="temp.log">
      <wc-status item="unversioned" props="none" />
    </entry>
  </target>
</status>`;

    const { files, counts } = parseSvnStatusXml(xml, wcRoot);
    expect(files).toHaveLength(6);
    expect(counts).toEqual({
      modified: 1,
      added: 1,
      deleted: 0,
      unversioned: 1,
      conflicted: 1,
      treeConflicts: 1,
      incoming: 1,
    });
  });

  it('parses svn log --xml with single and multiple log entries', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="145">
    <author>karim</author>
    <date>2026-11-23T09:10:00Z</date>
    <paths>
      <path action="A">/branches/billing/pdf.ts</path>
      <path action="D">/branches/billing/old.ts</path>
    </paths>
    <msg>Add PDF export</msg>
  </logentry>
</log>`;

    const logs = parseSvnLogXml(xml);
    expect(logs).toHaveLength(1);
    expect(logs[0].revision).toBe(145);
    expect(logs[0].author).toBe('karim');
    expect(logs[0].message).toBe('Add PDF export');
    expect(logs[0].changedPaths).toHaveLength(2);
    expect(logs[0].changedPaths[0].action).toBe('A');
  });

  it('parses svn merge output including text conflicts, prop conflicts, and tree conflicts', () => {
    const stdout = [
      '--- Merging r143 through r145 into \'.\':',
      'U    src/routes/patients.ts',
      'A    src/utils/pdfExporter.ts',
      'D    src/old/helper.ts',
      'G    src/common/format.ts',
      'C    src/services/invoiceCalculator.ts',
      ' C   src/config/propsOnly.ts',
      '   C src/legacy/oldReport.ts',
      '--- Recording mergeinfo for merge of r143 through r145 into \'.\':',
      ' U   .',
      'Summary of conflicts:',
      '  Text conflicts: 2',
      '  Tree conflicts: 1',
    ].join('\n');

    const { impacts, summary } = parseMergeOutput(stdout);
    expect(impacts.find((i) => i.path === 'src/services/invoiceCalculator.ts')?.isConflict).toBe(true);
    expect(impacts.find((i) => i.path === 'src/config/propsOnly.ts')?.isConflict).toBe(true);
    expect(impacts.find((i) => i.path === 'src/legacy/oldReport.ts')?.treeConflict).toBe(true);
    expect(summary.updated).toBe(1);
    expect(summary.added).toBe(1);
    expect(summary.deleted).toBe(1);
    expect(summary.merged).toBe(1);
    expect(summary.textConflicts).toBe(2);
    expect(summary.treeConflicts).toBe(1);
  });

  it('parses svn mergeinfo eligible output', () => {
    const revs = parseMergeinfoEligible('r145\nr143*\nr144\n');
    expect(revs).toEqual([143, 144, 145]);
  });
});
