'use strict';
const fs = require('fs');

/**
 * Does this file's first few bytes match the type its extension claims?
 *
 * multer decides an upload's type from the Content-Type the client put on the
 * multipart part, which is a label the client chose — anything at all can
 * arrive announced as image/png. The extension is then picked from that label,
 * so the stored name agrees with the lie. nosniff and a fixed extension stop a
 * browser executing the result, but nothing stopped the file being stored and
 * handed back out under this site's name.
 *
 * Reading the signature is the cheap half of the answer: it will not tell you
 * a PNG is well-formed, but it does tell you a ZIP, an HTML page or a script
 * is not one.
 */
const SIGNATURES = {
  '.png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  '.pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  // The modern Office formats are ZIP containers; .xls and .doc are the old
  // OLE compound-document format.
  '.docx': [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  '.xlsx': [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  '.doc': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  '.xls': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
};

/** WebP is "RIFF" + 4 size bytes + "WEBP", so it needs the offset checked too. */
function isWebp(head) {
  return head.subarray(0, 4).toString('latin1') === 'RIFF'
    && head.subarray(8, 12).toString('latin1') === 'WEBP';
}

function readHead(filePath, n = 16) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(n);
    const read = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** True when the bytes on disk match `ext`. An unknown extension is refused. */
function matches(filePath, ext) {
  const head = readHead(filePath);
  if (!head.length) return false;
  if (ext === '.webp') return isWebp(head);
  const sigs = SIGNATURES[ext];
  if (!sigs) return false;
  return sigs.some((sig) => sig.every((byte, i) => head[i] === byte));
}

module.exports = { matches };
