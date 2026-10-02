/**
 * Vendors the engraving fonts of the pinned VexFlow into src/font-data.
 *
 * VexFlow's `vexflow/bravura` entry embeds Bravura (music) and Academico
 * (text, regular and bold) as WOFF2 `data:` URLs, which the browser fetches
 * under the page's `font-src`. The adapter registers the same bytes with
 * `new FontFace(family, bytes)` instead (no fetch, no CSP), so this script
 * copies them, byte for byte, into TypeScript modules (base64 constants) and
 * writes each family's SIL OFL 1.1 notice as the font itself states it (its
 * `name` table, license description, name ID 13).
 *
 * Run it from the repository root after a VexFlow upgrade, then format:
 *
 *   node packages/renderer-vexflow/scripts/vendor-fonts.mjs
 *   pnpm exec prettier --write packages/renderer-vexflow/src/font-data
 *
 * REN-04 fails while the vendored bytes differ from the installed VexFlow.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

const OUT = new URL('../src/font-data/', import.meta.url);
const ENTRY = import.meta.resolve('vexflow/bravura');
const PACKAGE_JSON = new URL('../../../package.json', ENTRY);
const VEXFLOW_VERSION = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version;

/** WOFF2 known-table tags, by the index a table directory entry may use (WOFF2 §5.1). */
const KNOWN_TAGS = (
  'cmap|head|hhea|hmtx|maxp|name|OS/2|post|cvt |fpgm|glyf|loca|prep|CFF |VORG|EBDT|EBLC|gasp|hdmx|' +
  'kern|LTSH|PCLT|VDMX|vhea|vmtx|BASE|GDEF|GPOS|GSUB|EBSC|JSTF|MATH|CBDT|CBLC|COLR|CPAL|SVG |sbix|' +
  'acnt|avar|bdat|bloc|bsln|cvar|fdsc|feat|fmtx|fvar|gvar|hsty|just|lcar|mort|morx|opbd|prop|trak|' +
  'Zapf|Silf|Glat|Gloc|Feat|Sill'
).split('|');

/** The WOFF2 bytes of a `data:font/woff2;...;base64,` URL exported by a VexFlow font module. */
async function vexflowFont(file, exportName) {
  const module = await import(new URL(`../src/fonts/${file}`, ENTRY).href);
  const dataUrl = module[exportName];
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf('base64,') + 'base64,'.length), 'base64');
  if (bytes.toString('latin1', 0, 4) !== 'wOF2') {
    throw new Error(`${file} is not a WOFF2 font`);
  }
  return bytes;
}

/** The Windows/Unicode English strings of a WOFF2 font's `name` table, by name ID. */
function nameStrings(woff2) {
  let at = 12;
  const numTables = woff2.readUInt16BE(at);
  at = 20;
  const totalCompressedSize = woff2.readUInt32BE(at);
  at = 48;
  const base128 = () => {
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      const byte = woff2[at++];
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        return value;
      }
    }
    throw new Error('Invalid UIntBase128');
  };
  const tables = [];
  for (let index = 0; index < numTables; index += 1) {
    const flags = woff2[at++];
    const tag =
      (flags & 63) === 63 ? woff2.toString('latin1', at, (at += 4)) : KNOWN_TAGS[flags & 63];
    const version = flags >> 6;
    const length = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(woff2.subarray(at, at + totalCompressedSize));
  let offset = 0;
  let name;
  for (const table of tables) {
    if (table.tag === 'name') {
      name = data.subarray(offset, offset + table.length);
    }
    offset += table.length;
  }
  const strings = new Map();
  const count = name.readUInt16BE(2);
  const storage = name.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const record = 6 + index * 12;
    const [platform, encoding, language, nameId, length, start] = [0, 2, 4, 6, 8, 10].map((field) =>
      name.readUInt16BE(record + field),
    );
    if (platform === 3 && encoding === 1 && language === 0x409) {
      const raw = name.subarray(storage + start, storage + start + length);
      let text = '';
      for (let char = 0; char < raw.length; char += 2) {
        text += String.fromCharCode(raw.readUInt16BE(char));
      }
      strings.set(nameId, text);
    }
  }
  return strings;
}

const FAMILIES = [
  {
    module: 'bravura.ts',
    notice: 'Bravura-OFL.txt',
    faces: [{ constant: 'BRAVURA_WOFF2', file: 'bravura.js', exportName: 'Bravura' }],
  },
  {
    module: 'academico.ts',
    notice: 'Academico-OFL.txt',
    faces: [
      { constant: 'ACADEMICO_REGULAR_WOFF2', file: 'academico.js', exportName: 'Academico' },
      { constant: 'ACADEMICO_BOLD_WOFF2', file: 'academicobold.js', exportName: 'AcademicoBold' },
    ],
  },
];

for (const family of FAMILIES) {
  const constants = [];
  let notice;
  for (const face of family.faces) {
    const bytes = await vexflowFont(face.file, face.exportName);
    const names = nameStrings(bytes);
    const fullName = names.get(4);
    notice ??= names.get(13);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    constants.push(
      [
        `/**`,
        ` * ${fullName} ${names.get(5)} (${names.get(8)}), WOFF2, ${bytes.length} bytes, base64.`,
        ` * SHA-256 ${sha256}.`,
        ` */`,
        `export const ${face.constant} =`,
        `  '${bytes.toString('base64')}';`,
      ].join('\n'),
    );
    console.log(`${face.constant}: ${fullName} ${names.get(5)}, ${bytes.length} bytes, ${sha256}`);
  }
  const header = [
    `/**`,
    ` * Generated by scripts/vendor-fonts.mjs from vexflow ${VEXFLOW_VERSION} (build/esm/src/fonts):`,
    ` * the WOFF2 bytes VexFlow embeds, unchanged. Do not edit; licensed under the`,
    ` * SIL Open Font License 1.1, see ./${family.notice}.`,
    ` */`,
  ].join('\n');
  writeFileSync(new URL(family.module, OUT), `${header}\n\n${constants.join('\n\n')}\n`);
  writeFileSync(new URL(family.notice, OUT), `${notice.replace(/\r\n?/g, '\n').trimEnd()}\n`);
}
