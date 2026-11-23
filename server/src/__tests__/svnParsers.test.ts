import { describe, expect, it } from 'vitest';
import {
  parseMergeinfoEligible,
  parseMergeOutput,
  parseSvnInfoXml,
  parseSvnLogXml,
  parseSvnStatusXml,
} from '../utils/svnParsers';

describe('svnParsers', () => {
  it('parses svn info --xml from RCM root', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry kind="dir" path="." revision="7425">
    <url>https://128.1.1.32/svn/rcm</url>
    <relative-url>^/</relative-url>
    <repository><root>https://128.1.1.32/svn/rcm</root></repository>
    <commit revision="7425">
      <author>Walid</author>
      <date>2026-11-23T12:22:36.000000Z</date>
    </commit>
  </entry>
</info>`;

    const info = parseSvnInfoXml(xml);
    expect(info.url).toBe('https://128.1.1.32/svn/rcm');
    expect(info.revision).toBe(7425);
    expect(info.lastChangedAuthor).toBe('Walid');
  });

  it('parses svn status --xml for module subfolder', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src\\services\\claimCalculator.ts"><wc-status item="conflicted" props="none" /></entry>
    <entry path="src\\utils\\qr.ts"><wc-status item="unversioned" props="none" /></entry>
  </target>
</status>`;

    const files = parseSvnStatusXml(xml, 'C:\\Users\\appdev3l\\Desktop\\rcm\\billing\\rcm-api');
    expect(files).toHaveLength(2);
    expect(files[0].status).toBe('conflicted');
    expect(files[1].status).toBe('unversioned');
  });

  it('parses svn merge output and mergeinfo eligible revisions', () => {
    const out = [
      '--- Merging r7424 through r7425 into \'.\':',
      'U    src/controllers/invoiceController.ts',
      'C    src/services/claimCalculator.ts',
      '   C src/legacy/old.ts',
    ].join('\n');
    const impacts = parseMergeOutput(out);
    expect(impacts).toHaveLength(3);
    expect(impacts[1].isConflict).toBe(true);
    expect(impacts[2].treeConflict).toBe(true);
    expect(parseMergeinfoEligible('r7424\nr7425*\n')).toEqual([7424, 7425]);
  });

  it('parses svn log --xml', () => {
    const xml = `<log><logentry revision="7425"><author>Walid</author><date>2026-11-23T12:00:00Z</date><paths><path action="M">/billing/rcm-api/a.ts</path></paths><msg>Fix billing</msg></logentry></log>`;
    const logs = parseSvnLogXml(xml);
    expect(logs).toHaveLength(1);
    expect(logs[0].revision).toBe(7425);
    expect(logs[0].author).toBe('Walid');
  });
});
