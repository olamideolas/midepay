#!/usr/bin/env node
/**
 * MidePay v4.0 — Node.js ECMA-376 OpenXML (.docx) Compiler & Verifier
 * Zero external dependencies (uses Node built-in `fs`, `path`, `zlib`).
 * Produces the exact same ECMA-376 WordprocessingML archive as `build_sdlc_docx.py`
 * and verifies all 76 numbered SDLC sections inside `word/document.xml`.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const MD_PATH = path.join(ROOT_DIR, 'docs', 'MidePay_Complete_76_SDLC_Deliverables.md');
const DOCX_PATH = path.join(ROOT_DIR, 'docs', 'MidePay_Complete_76_SDLC_Deliverables_Compendium.docx');

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripInlineMd(text) {
  return String(text)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function verify76Sections(mdText) {
  const regex = /^##\s+(\d+)\.\s+(.+)$/gm;
  const found = new Map();
  let m;
  while ((m = regex.exec(mdText)) !== null) {
    found.set(Number(m[1]), m[2].trim());
  }
  const missing = [];
  for (let i = 1; i <= 76; i++) {
    if (!found.has(i)) missing.push(i);
  }
  if (missing.length > 0) {
    throw new Error(`Missing numbered SDLC sections: ${missing.join(', ')}`);
  }
  return found;
}

function parseMarkdownBlocks(mdText) {
  const lines = mdText.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < n && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < n && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1])) {
      const rows = [];
      while (i < n && lines[i].includes('|') && lines[i].trim()) {
        const raw = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '');
        const cells = raw.split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) {
          rows.push(cells);
        }
        i++;
      }
      if (rows.length > 0) blocks.push({ type: 'table', rows });
      continue;
    }

    const mh = line.match(/^(#{1,4})\s+(.+)$/);
    if (mh) {
      blocks.push({ type: 'heading', level: mh[1].length, text: mh[2].trim() });
      i++;
      continue;
    }

    if (line.trimStart().startsWith('>')) {
      const qLines = [];
      while (i < n && lines[i].trimStart().startsWith('>')) {
        qLines.push(lines[i].replace(/^\s*>\s?/, '').trim());
        i++;
      }
      blocks.push({ type: 'quote', text: qLines.filter(Boolean).join(' ') });
      continue;
    }

    const mli = line.match(/^(\s*(?:[-*]|\d+\.))\s+(.+)$/);
    if (mli) {
      blocks.push({ type: 'list_item', bullet: mli[1].trim(), text: mli[2].trim() });
      i++;
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const paraLines = [line.trim()];
    i++;
    while (
      i < n &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !/^\s*---+\s*$/.test(lines[i]) &&
      !/^(\s*(?:[-*]|\d+\.))\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < n && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
  }

  return blocks;
}

function buildOoxmlRuns(text, defaultSizeHalfPt = 21, defaultColor = '1E293B') {
  const tokens = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  const runs = [];
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      const clean = xmlEscape(tok.slice(2, -2));
      runs.push(`<w:r><w:rPr><w:b/><w:color w:val="${defaultColor}"/><w:sz w:val="${defaultSizeHalfPt}"/></w:rPr><w:t xml:space="preserve">${clean}</w:t></w:r>`);
    } else if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
      const clean = xmlEscape(tok.slice(1, -1));
      runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="047857"/><w:sz w:val="${Math.max(18, defaultSizeHalfPt - 2)}"/></w:rPr><w:t xml:space="preserve">${clean}</w:t></w:r>`);
    } else {
      const clean = xmlEscape(stripInlineMd(tok));
      runs.push(`<w:r><w:rPr><w:color w:val="${defaultColor}"/><w:sz w:val="${defaultSizeHalfPt}"/></w:rPr><w:t xml:space="preserve">${clean}</w:t></w:r>`);
    }
  }
  return runs.join('');
}

// Minimal standards-compliant PKZIP writer (CRC-32 + DEFLATE)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compBuf = zlib.deflateRawSync(rawBuf, { level: 9 });
    const crc = crc32(rawBuf);

    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034B50, 0); // signature
    localHdr.writeUInt16LE(20, 4);         // version needed
    localHdr.writeUInt16LE(0, 6);          // flags
    localHdr.writeUInt16LE(8, 8);          // method: deflate
    localHdr.writeUInt16LE(0, 10);         // mod time
    localHdr.writeUInt16LE(0x5770, 12);    // mod date
    localHdr.writeUInt32LE(crc, 14);
    localHdr.writeUInt32LE(compBuf.length, 18);
    localHdr.writeUInt32LE(rawBuf.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    localParts.push(localHdr, nameBuf, compBuf);

    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014B50, 0);
    centralHdr.writeUInt16LE(20, 4);
    centralHdr.writeUInt16LE(20, 6);
    centralHdr.writeUInt16LE(0, 8);
    centralHdr.writeUInt16LE(8, 10);
    centralHdr.writeUInt16LE(0, 12);
    centralHdr.writeUInt16LE(0x5770, 14);
    centralHdr.writeUInt32LE(crc, 16);
    centralHdr.writeUInt32LE(compBuf.length, 20);
    centralHdr.writeUInt32LE(rawBuf.length, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(0, 30);
    centralHdr.writeUInt16LE(0, 32);
    centralHdr.writeUInt16LE(0, 34);
    centralHdr.writeUInt16LE(0, 36);
    centralHdr.writeUInt32LE(0, 38);
    centralHdr.writeUInt32LE(offset, 42);

    centralParts.push(centralHdr, nameBuf);
    offset += localHdr.length + nameBuf.length + compBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function buildDocx(blocks) {
  const bodyParts = [];

  for (const b of blocks) {
    if (b.type === 'heading') {
      const txt = xmlEscape(stripInlineMd(b.text));
      if (b.level === 1) {
        bodyParts.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="360" w:after="160"/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="10B981"/></w:pBdr></w:pPr><w:r><w:rPr><w:b/><w:color w:val="064E3B"/><w:sz w:val="34"/></w:rPr><w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`);
      } else if (b.level === 2) {
        bodyParts.push(`<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="280" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="047857"/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`);
      } else {
        const sz = b.level === 3 ? '24' : '22';
        bodyParts.push(`<w:p><w:pPr><w:pStyle w:val="Heading3"/><w:spacing w:before="200" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`);
      }
    } else if (b.type === 'paragraph') {
      bodyParts.push(`<w:p><w:pPr><w:spacing w:before="60" w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>${buildOoxmlRuns(b.text)}</w:p>`);
    } else if (b.type === 'list_item') {
      const prefix = (b.bullet === '-' || b.bullet === '*') ? '• ' : `${b.bullet} `;
      bodyParts.push(`<w:p><w:pPr><w:ind w:left="360"/><w:spacing w:before="40" w:after="80"/></w:pPr>${buildOoxmlRuns(prefix + b.text)}</w:p>`);
    } else if (b.type === 'quote') {
      bodyParts.push(`<w:p><w:pPr><w:ind w:left="420" w:right="240"/><w:shd w:val="clear" w:color="auto" w:fill="ECFDF5"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="10B981"/></w:pBdr><w:spacing w:before="120" w:after="120"/></w:pPr>${buildOoxmlRuns(b.text, 20, '065F46')}</w:p>`);
    } else if (b.type === 'code') {
      const cLines = b.text.split('\n');
      for (const cl of cLines) {
        bodyParts.push(`<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/><w:spacing w:before="0" w:after="20"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="0F172A"/><w:sz w:val="17"/></w:rPr><w:t xml:space="preserve">${xmlEscape(cl)}</w:t></w:r></w:p>`);
      }
    } else if (b.type === 'table') {
      const colCount = Math.max(...b.rows.map(r => r.length));
      const tbl = [
        '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>',
        '<w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>',
        '<w:left w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>',
        '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>',
        '<w:right w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>',
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>',
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>',
        '</w:tblBorders></w:tblPr>'
      ];
      b.rows.forEach((row, rIdx) => {
        const isHdr = rIdx === 0;
        tbl.push('<w:tr>');
        for (let cIdx = 0; cIdx < colCount; cIdx++) {
          const cellTxt = row[cIdx] || '';
          const shd = isHdr
            ? '<w:shd w:val="clear" w:color="auto" w:fill="064E3B"/>'
            : (rIdx % 2 === 1 ? '<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>' : '');
          const runs = isHdr
            ? `<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xmlEscape(stripInlineMd(cellTxt))}</w:t></w:r>`
            : buildOoxmlRuns(cellTxt, 18, '1E293B');
          tbl.push(`<w:tc><w:tcPr>${shd}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>${runs}</w:p></w:tc>`);
        }
        tbl.push('</w:tr>');
      });
      tbl.push('</w:tbl><w:p/>');
      bodyParts.push(tbl.join(''));
    }
  }

  const sectPr = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyParts.join('')}${sectPr}</w:body></w:document>`;

  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style></w:styles>';

  const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';

  const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';

  const docRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>MidePay v4.0 — Complete 76-Document Enterprise SDLC Compendium</dc:title><dc:creator>MidePay Enterprise Architecture, Security &amp; Governance</dc:creator><dc:description>Complete 76-Deliverable Production SDLC Suite for MidePay Nigeria</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified></cp:coreProperties>`;

  const appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>MidePay Enterprise SDLC Compiler v4.0</Application><Company>MidePay Technologies Ltd</Company></Properties>';

  const zipBuf = createZipBuffer([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsXml },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/_rels/document.xml.rels', data: docRelsXml },
    { name: 'docProps/core.xml', data: coreXml },
    { name: 'docProps/app.xml', data: appXml }
  ]);

  fs.mkdirSync(path.dirname(DOCX_PATH), { recursive: true });
  fs.writeFileSync(DOCX_PATH, zipBuf);

  // Verify all 76 numbered headings inside generated documentXml
  const plainText = [...documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
  for (let i = 1; i <= 76; i++) {
    if (!plainText.includes(`${i}. `)) {
      throw new Error(`Verification failed: Section ${i} missing inside word/document.xml`);
    }
  }

  return zipBuf.length;
}

function main() {
  const mdText = fs.readFileSync(MD_PATH, 'utf8');
  const sections = verify76Sections(mdText);
  const blocks = parseMarkdownBlocks(mdText);
  const bytes = buildDocx(blocks);
  console.log(`[OK] Verified ${sections.size}/76 numbered sections in ${path.basename(MD_PATH)}`);
  console.log(`[OK] Compiled Word Compendium: ${DOCX_PATH} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`[OK] Post-build OOXML verification passed: 76/76 sections intact.`);
}

main();

