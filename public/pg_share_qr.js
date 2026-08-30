// pg_share_qr.js — a tiny, dependency-free QR block for share cards.
//
// Drawing a cross-origin QR image onto the card canvas would taint it and make
// toBlob() throw, so the QR is baked in as a module matrix and painted as rects —
// the canvas stays clean and exportable.
//
// The matrix below encodes https://pangolinrc.com (QR version 2, ECC level M,
// 25×25 modules). Regenerate with `qrcode-generator`:
//   const qr = require('qrcode-generator')(0,'M');
//   qr.addData('https://pangolinrc.com'); qr.make();
//   for(r) for(c) qr.isDark(r,c)
// If the target URL changes, swap the rows (and keep the module count in sync).
(function (root) {
  var URL_TEXT = 'pangolinrc.com';
  var ROWS = [
    '1111111001001011001111111',
    '1000001010011001001000001',
    '1011101001111001101011101',
    '1011101001011001101011101',
    '1011101011111111001011101',
    '1000001000111011001000001',
    '1111111010101010101111111',
    '0000000001101100100000000',
    '1010101000011101100010010',
    '0010100010110100111000001',
    '0110101000110110001010111',
    '1001000000101111000100010',
    '0111111010010101111101011',
    '0001010000110000111001001',
    '1011001011100100110100111',
    '0100010010010111111010010',
    '1001111010001101111111000',
    '0000000011011001100011011',
    '1111111001111001101011011',
    '1000001001001110100011011',
    '1011101011010010111111011',
    '1011101001110000100111100',
    '1011101011100101000010001',
    '1000001000010001100011010',
    '1111111010001001110100011'
  ];
  var N = ROWS.length;

  // Draw the QR into a `size`×`size` box at (x,y), including a white quiet-zone
  // background so it scans off a busy poster. `light`/`dark` override colors.
  function drawQR(ctx, x, y, size, opts) {
    opts = opts || {};
    var dark = opts.dark || '#0b0907';
    var light = opts.light || '#ffffff';
    var quiet = opts.quiet == null ? 3 : opts.quiet;        // modules of white border
    var total = N + quiet * 2;
    var m = size / total;                                    // module pixel size
    // rounded white plate
    var r = opts.radius == null ? Math.round(m * 2) : opts.radius;
    ctx.fillStyle = light;
    _rrect(ctx, x, y, size, size, r);
    ctx.fill();
    // modules
    ctx.fillStyle = dark;
    for (var row = 0; row < N; row++) {
      var s = ROWS[row];
      for (var col = 0; col < N; col++) {
        if (s.charCodeAt(col) === 49) {                      // '1'
          // +0.5 overdraw removes hairline seams between modules
          ctx.fillRect(
            x + (col + quiet) * m,
            y + (row + quiet) * m,
            Math.ceil(m) + 0.5,
            Math.ceil(m) + 0.5
          );
        }
      }
    }
  }
  function _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  root.PG_QR = { drawQR: drawQR, urlText: URL_TEXT, moduleCount: N };
})(typeof window !== 'undefined' ? window : this);
