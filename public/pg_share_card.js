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

  // The visual URL on the card (short brand). The share caption/clipboard uses the real
  // join link (join.pangolinrc.com) — see the share flow — but the art stays clean.
  var CARD_URL = 'pangolinrc.com';

  // Universal 9:16 title-safe band. Reels / Stories / TikTok / Shorts all overlay chrome at
  // the top (profile/close ~top 12%) and, more heavily, the bottom (caption, handle, audio,
  // the action rail + "Send message" bar — up to ~34%). So the ONLY region guaranteed visible
  // everywhere is the vertical middle. We center the whole copy panel in that band, biased a
  // touch upward since the bottom chrome is taller than the top.
  var SAFE_TOP = 250;                 // keep content below the top chrome
  var SAFE_BOTTOM = H - 640;          // …and above the bottom chrome (≈ y1280)
  var SAFE_MID = Math.round((SAFE_TOP + SAFE_BOTTOM) / 2);   // ≈ 765

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
      // 2 — even, mild darkening so the poster still reads but the centered panel edge sits well
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0.00, 'rgba(9,6,4,0.55)');
      g.addColorStop(0.30, 'rgba(9,6,4,0.30)');
      g.addColorStop(0.70, 'rgba(9,6,4,0.30)');
      g.addColorStop(1.00, 'rgba(9,6,4,0.62)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

      // 3 — brand chip, top-left, inside the top safe area
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 1;
      ctx.fillStyle = '#e89f3d'; ctx.font = '600 30px "IBM Plex Mono", monospace';
      ctx.fillText(opts.brand || 'PANGOLINRC', PAD, 150);
      ctx.restore();

      // 4 — MEASURE the copy so we can center the panel in the title-safe band.
      var panelPad = 60;
      // Leave a right-hand column free for the vertical URL mark (which rides above the IG/
      // TikTok action rail), so the panel copy never fights the buttons.
      var RAIL_COL = 132;
      var panelX = PAD, panelW = (W - RAIL_COL) - PAD;
      var colX = panelX + panelPad;              // text left edge inside the panel
      var colW = panelW - 2 * panelPad;

      var TITLE_LH = 84, QUOTE_LH = 56, AV = 64, FOOTER_H = 116;
      ctx.font = '700 76px "Space Grotesk", system-ui, sans-serif';
      var titleLines = _wrap(ctx, opts.title || '', colW, 2);
      var quoteLines = [];
      if (!opts.spoiler && opts.quote) {
        ctx.font = 'italic 40px Inter, system-ui, sans-serif';
        quoteLines = _wrap(ctx, '“' + opts.quote + '”', colW, 3);
      }
      var titleH = titleLines.length * TITLE_LH;
      var quoteH = opts.spoiler ? 60 : quoteLines.length * QUOTE_LH;
      var metaH = opts.meta ? 40 : 0;
      // gaps: attr→title, title→quote, quote→meta, meta→divider, divider→footer
      var G_AT = 34, G_TQ = 20, G_QM = 22, G_MD = 30, G_DF = 34, DIV = 2;
      var contentH = AV + G_AT + titleH + G_TQ + quoteH +
                     (metaH ? G_QM + metaH : 0) + G_MD + DIV + G_DF + FOOTER_H;
      var panelH = contentH + panelPad * 2;
      var panelY = Math.round(SAFE_MID - panelH / 2);
      if (panelY < SAFE_TOP) panelY = SAFE_TOP;                 // never ride into the top chrome

      // panel — translucent slab keeps the copy legible over ANY poster, and its edges live
      // wholly inside the safe band so nothing important is ever cropped.
      ctx.fillStyle = 'rgba(10,7,5,0.72)';
      _rr(ctx, panelX, panelY, panelW, panelH, 40); ctx.fill();
      ctx.strokeStyle = 'rgba(232,169,61,0.28)'; ctx.lineWidth = 2;
      _rr(ctx, panelX, panelY, panelW, panelH, 40); ctx.stroke();

      // 5 — draw the copy top-down inside the panel
      var y = panelY + panelPad;
      var name = opts.name || '';

      // attribution — avatar + name
      var ay = y;
      ctx.save();
      ctx.beginPath(); ctx.arc(colX + AV / 2, ay + AV / 2, AV / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      if (avatar) {
        var as = Math.max(AV / avatar.width, AV / avatar.height);
        ctx.drawImage(avatar, colX + AV / 2 - avatar.width * as / 2, ay + AV / 2 - avatar.height * as / 2,
          avatar.width * as, avatar.height * as);
      } else {
        ctx.fillStyle = 'rgba(232,159,61,0.9)'; ctx.fillRect(colX, ay, AV, AV);
        ctx.fillStyle = '#1a1209'; ctx.font = '700 34px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText((name || '?').trim().charAt(0).toUpperCase(), colX + AV / 2, ay + AV / 2 + 12); ctx.textAlign = 'left';
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(232,169,61,0.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(colX + AV / 2, ay + AV / 2, AV / 2, 0, Math.PI * 2); ctx.stroke();
      if (name) {
        ctx.fillStyle = '#f3ebe0'; ctx.font = '600 36px Inter, system-ui, sans-serif';
        ctx.fillText(name, colX + AV + 22, ay + AV / 2 + 13);
      }
      y += AV + G_AT;

      // title (big)
      ctx.fillStyle = '#f5efe4'; ctx.font = '700 76px "Space Grotesk", system-ui, sans-serif';
      for (var j = 0; j < titleLines.length; j++) { ctx.fillText(titleLines[j], colX, y + 64); y += TITLE_LH; }
      y += G_TQ;

      // quote / comment (italic), or a spoiler lock line
      if (opts.spoiler) {
        ctx.fillStyle = '#ff9d5c'; ctx.font = '600 34px Inter, system-ui, sans-serif';
        ctx.fillText('⚠ spoiler — watch it first', colX, y + 34); y += 60;
      } else if (quoteLines.length) {
        ctx.fillStyle = '#ece2d4'; ctx.font = 'italic 40px Inter, system-ui, sans-serif';
        for (var i = 0; i < quoteLines.length; i++) { ctx.fillText(quoteLines[i], colX, y + 40); y += QUOTE_LH; }
      }

      // meta (mono amber)
      if (opts.meta) {
        y += G_QM;
        ctx.fillStyle = '#c9a44f'; ctx.font = '500 30px "IBM Plex Mono", monospace';
        ctx.fillText(opts.meta, colX, y + 30); y += metaH;
      }

      // divider
      y += G_MD;
      ctx.strokeStyle = 'rgba(232,169,61,0.30)'; ctx.lineWidth = DIV;
      ctx.beginPath(); ctx.moveTo(colX, y); ctx.lineTo(colX + colW, y); ctx.stroke();
      y += G_DF;

      // footer — Pierre (left) + a small prompt. The URL itself is a VERTICAL mark on the
      // right rail column (drawn below), above the action-rail icons, so it never hides
      // under the like/comment/share buttons.
      var footTop = y;
      var pRight = colX;
      if (pierre) {
        var pH = FOOTER_H, pW2 = Math.round(pH * pierre.width / pierre.height);
        ctx.drawImage(pierre, colX - 8, footTop, pW2, pH);
        pRight = colX - 8 + pW2;
      }
      ctx.fillStyle = 'rgba(232,169,61,0.92)'; ctx.font = '500 28px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText('watch along  →', pRight + 20, footTop + FOOTER_H / 2);
      ctx.textBaseline = 'alphabetic';

      // vertical brand URL — runs UP the right column, ending above where the action-rail
      // icon stack sits, and pulled in from the frame edge so it clears the rail entirely.
      ctx.save();
      var urlX = W - RAIL_COL / 2;                 // centered in the right column
      var urlBottom = SAFE_BOTTOM - 300;           // its baseline foot — raised well above the icon stack
      ctx.translate(urlX, urlBottom);
      ctx.rotate(-Math.PI / 2);                     // reads bottom-to-top
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 16; ctx.shadowOffsetX = 1;
      ctx.fillStyle = '#f5efe4'; ctx.font = '700 56px "Space Grotesk", system-ui, sans-serif';
      ctx.fillText(CARD_URL, 0, 0);
      ctx.restore();

      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/png');
      });
    });
  }

  root.PGShareCard = { buildPoster: buildPoster, W: W, H: H, cardUrl: CARD_URL };
})(typeof window !== 'undefined' ? window : this);
