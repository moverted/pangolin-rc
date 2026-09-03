// pg_share_card.js — one poster-forward 9:16 share card, used by both the IRL
// ticket share (BROWSE face) and the TV-show reflection share (PIERRE face) so
// every pangolinRC share reads as the same object.
//
// The look: the poster fills the whole 1080×1920 frame; a bottom-weighted scrim
// keeps it legible; and a bottom band presents the share — Pierre (the host) at the
// lower-left, the sharer's words in the middle, and a scannable QR to pangolinrc.com
// on the right. Needs window.PG_QR (pg_share_qr.js).
(function (root) {
  var W = 1080, H = 1920;
  var PAD = 72;

  function _rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function _wrap(ctx, text, maxW, maxLines) {
    var words = String(text || '').split(/\s+/), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = t;
    }
    if (line) lines.push(line);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.replace(/\s*\S+$/, '');
      lines[maxLines - 1] = last + '…';
    }
    return lines;
  }
  function _loadImg(src, cross) {
    return new Promise(function (res) {
      if (!src) return res(null);
      var img = new Image();
      if (cross) img.crossOrigin = 'anonymous';
      img.onload = function () { res(img); };
      img.onerror = function () { res(null); };
      img.src = src;
    });
  }
  function _posterSrc(poster, proxyBase) {
    if (!poster) return null;
    if (/^(data:|blob:)/.test(poster)) return { src: poster, cross: false };
    if (proxyBase && /^https:\/\/(image\.tmdb\.org|m\.media-amazon\.com)\//.test(poster))
      return { src: proxyBase + '/img?u=' + encodeURIComponent(poster), cross: true };
    return { src: poster, cross: true };
  }

  // Cut Pierre out of his white studio plate: flood-fill white inward from the edges
  // (so enclosed whites survive), background → transparent, its light fringe darkened,
  // then trim to his silhouette. Same-origin PNG → getImageData is untainted. Cached.
  var _pierre = null;
  function _cutout(img) {
    var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    var x = c.getContext('2d'); x.drawImage(img, 0, 0);
    var Wd = c.width, Hd = c.height, d = x.getImageData(0, 0, Wd, Hd), p = d.data;
    var bg = new Uint8Array(Wd * Hd), stack = [];
    var white = function (idx) { var i = idx * 4; return p[i] > 224 && p[i + 1] > 224 && p[i + 2] > 224; };
    function seed(xx, yy) { if (xx < 0 || yy < 0 || xx >= Wd || yy >= Hd) return; var idx = yy * Wd + xx;
      if (!bg[idx] && white(idx)) { bg[idx] = 1; stack.push(idx); } }
    for (var xx = 0; xx < Wd; xx++) { seed(xx, 0); seed(xx, Hd - 1); }
    for (var yy = 0; yy < Hd; yy++) { seed(0, yy); seed(Wd - 1, yy); }
    while (stack.length) { var idx = stack.pop(), cx = idx % Wd, cy = (idx / Wd) | 0;
      seed(cx - 1, cy); seed(cx + 1, cy); seed(cx, cy - 1); seed(cx, cy + 1); }
    var x0 = Wd, y0 = Hd, x1 = 0, y1 = 0;
    for (var yy2 = 0; yy2 < Hd; yy2++) for (var xx2 = 0; xx2 < Wd; xx2++) {
      var id2 = yy2 * Wd + xx2, i = id2 * 4;
      if (bg[id2]) { p[i + 3] = 0; continue; }
      if (p[i] > 168 && p[i + 1] > 168 && p[i + 2] > 168) {
        var edge = (xx2 > 0 && bg[id2 - 1]) || (xx2 < Wd - 1 && bg[id2 + 1]) ||
                   (yy2 > 0 && bg[id2 - Wd]) || (yy2 < Hd - 1 && bg[id2 + Wd]);
        if (edge) { p[i] *= 0.45; p[i + 1] *= 0.45; p[i + 2] *= 0.45; }
      }
      if (xx2 < x0) x0 = xx2; if (xx2 > x1) x1 = xx2; if (yy2 < y0) y0 = yy2; if (yy2 > y1) y1 = yy2;
    }
    x.putImageData(d, 0, 0);
    var tw = Math.max(1, x1 - x0 + 1), th = Math.max(1, y1 - y0 + 1);
    var t = document.createElement('canvas'); t.width = tw; t.height = th;
    t.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th); return t;
  }
  function _loadPierre() {
    if (_pierre) return _pierre;
    _pierre = _loadImg('/pierre.png', false).then(function (img) {
      try { return img ? _cutout(img) : null; } catch (_) { return null; }
    });
    return _pierre;
  }

  // opts: { poster, proxyBase, brand, title, quote, meta, spoiler, name, avatar } → Promise<Blob>
  function buildPoster(opts) {
    opts = opts || {};
    var ps = _posterSrc(opts.poster, opts.proxyBase);
    return Promise.all([
      ps ? _loadImg(ps.src, ps.cross) : Promise.resolve(null),
      opts.avatar ? _loadImg(opts.avatar, false) : Promise.resolve(null),
      _loadPierre()
    ]).then(function (imgs) {
      var poster = imgs[0], avatar = imgs[1], pierre = imgs[2];
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var ctx = c.getContext('2d');

      // 1 — poster fills the frame (cover)
      ctx.fillStyle = '#0f0b08'; ctx.fillRect(0, 0, W, H);
      if (poster) {
        var s = Math.max(W / poster.width, H / poster.height);
        var pw = poster.width * s, ph = poster.height * s;
        ctx.drawImage(poster, (W - pw) / 2, (H - ph) / 2, pw, ph);
      }
      // 2 — bottom-weighted scrim (the band needs a darker floor than before)
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0.00, 'rgba(9,6,4,0.28)');
      g.addColorStop(0.38, 'rgba(9,6,4,0.02)');
      g.addColorStop(0.56, 'rgba(9,6,4,0.55)');
      g.addColorStop(0.74, 'rgba(9,6,4,0.90)');
      g.addColorStop(1.00, 'rgba(9,6,4,0.98)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

      // 3 — brand chip, top-left (shadow so it survives a bright poster top)
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 1;
      ctx.fillStyle = '#e89f3d'; ctx.font = '600 30px "IBM Plex Mono", monospace';
      ctx.fillText(opts.brand || 'PANGOLINRC', PAD, 128);
      ctx.restore();

      // 4 — the bottom band baseline (Pierre · pangolinrc.com · QR) and, above it,
      //     the content block (avatar+name → big title → quote → meta) built bottom-up.
      var bandBottom = H - PAD;                     // 1848
      var QR = 140, qrX = W - PAD - QR, qrY = bandBottom - QR;
      var colW = W - 2 * PAD;

      // content block — anchored just above the band, growing upward
      var y = qrY - 46;
      // meta (mono amber): episode/unit · platform, or theater · date
      if (opts.meta) {
        ctx.fillStyle = '#c9a44f'; ctx.font = '500 30px "IBM Plex Mono", monospace';
        ctx.fillText(opts.meta, PAD, y); y -= 56;
      }
      // quote / comment (italic), or a spoiler lock line
      if (opts.spoiler) {
        ctx.fillStyle = '#ff9d5c'; ctx.font = '600 32px Inter, system-ui, sans-serif';
        ctx.fillText('⚠ spoiler — watch it first', PAD, y); y -= 60;
      } else if (opts.quote) {
        ctx.fillStyle = '#ece2d4'; ctx.font = 'italic 38px Inter, system-ui, sans-serif';
        var ql = _wrap(ctx, '“' + opts.quote + '”', colW, 2);
        for (var i = ql.length - 1; i >= 0; i--) { ctx.fillText(ql[i], PAD, y); y -= 50; }
        y -= 8;
      }
      // title (big — the Moonlighting look), 2 lines max, bottom-up
      ctx.fillStyle = '#f5efe4'; ctx.font = '700 76px "Space Grotesk", system-ui, sans-serif';
      var tl = _wrap(ctx, opts.title || '', colW, 2);
      for (var j = tl.length - 1; j >= 0; j--) { ctx.fillText(tl[j], PAD, y); y -= 84; }
      y -= 20;
      // avatar + name (attribution), just above the title
      var name = opts.name || '';
      var av = 64, ay = y - av;
      ctx.save();
      ctx.beginPath(); ctx.arc(PAD + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      if (avatar) {
        var as = Math.max(av / avatar.width, av / avatar.height);
        ctx.drawImage(avatar, PAD + av / 2 - avatar.width * as / 2, ay + av / 2 - avatar.height * as / 2,
          avatar.width * as, avatar.height * as);
      } else {
        ctx.fillStyle = 'rgba(232,159,61,0.9)'; ctx.fillRect(PAD, ay, av, av);
        ctx.fillStyle = '#1a1209'; ctx.font = '700 34px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText((name || '?').trim().charAt(0).toUpperCase(), PAD + av / 2, ay + av / 2 + 12); ctx.textAlign = 'left';
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(232,169,61,0.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(PAD + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2); ctx.stroke();
      if (name) {
        ctx.fillStyle = '#f3ebe0'; ctx.font = '600 36px Inter, system-ui, sans-serif';
        ctx.fillText(name, PAD + av + 22, ay + av / 2 + 13);
      }

      // 5 — bottom band: Pierre (left) · pangolinrc.com + scan (middle) · QR (right)
      var pierreRight = PAD;
      if (pierre) {
        var pH = QR, pW2 = Math.round(pH * pierre.width / pierre.height);   // match the QR height
        ctx.drawImage(pierre, PAD - 6, bandBottom - pH, pW2, pH);
        pierreRight = PAD - 6 + pW2;
      }
      if (root.PG_QR) {
        root.PG_QR.drawQR(ctx, qrX, qrY, QR, { dark: '#0b0907', light: '#f6efe2' });
        var cx = (pierreRight + qrX) / 2;            // centered between Pierre and the QR
        var midY = qrY + QR / 2;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f5efe4'; ctx.font = '700 38px "Space Grotesk", system-ui, sans-serif';
        ctx.fillText(root.PG_QR.urlText, cx, midY - 2);
        ctx.fillStyle = 'rgba(232,169,61,0.92)'; ctx.font = '500 24px "IBM Plex Mono", monospace';
        ctx.fillText('scan to watch along', cx, midY + 32);
        ctx.textAlign = 'left';
      }

      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/png');
      });
    });
  }

  root.PGShareCard = { buildPoster: buildPoster, W: W, H: H };
})(typeof window !== 'undefined' ? window : this);
