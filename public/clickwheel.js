// clickwheel.js — the iPod-style click-wheel widget (the console wheel ONLY).
// Extracted from index.html. This file owns NO shell state and never mutates the
// cube directly: it reads focus + reaches the open face's document through the
// CubeShell interface it imports below, then drives that face's own content
// (scroll + the SELECT highlight/dialog). See the cube map in CLAUDE.md.
import { getFocus, getActiveDoc, FACE_INDEX } from './cube_shell.js';

// ─── iPod-style click wheel: the ring scrolls the open face; the four card actions
// (WATCH top / SHARE left / STOP right / SELECT center) drive the open show by
// synthetically clicking the WATCH face's own controls (same-origin iframe), so all
// existing behaviour — rotate-to-episodes, share dialog, stop animation — is reused.
(function initWheel(){
  const ring   = document.getElementById('wheelRing');
  const center = document.getElementById('wheelCenter');
  if(!ring) return;

  // Feedback: a synthesized "click" (the iPod tick) on every wheel click, plus a
  // vibration on platforms that support it. iOS Safari ignores navigator.vibrate,
  // so the sound is the iPhone fallback — but it plays everywhere. The AudioContext
  // must be unlocked inside a user gesture (primeAudio on pointer-down).
  let _ac = null;
  function primeAudio(){
    try {
      if(!_ac){ const AC = window.AudioContext || window.webkitAudioContext; if(AC) _ac = new AC(); }
      if(_ac && _ac.state === 'suspended') _ac.resume();
    } catch(_){}
  }
  function clickSound(){
    try {
      if(!_ac){ primeAudio(); if(!_ac) return; }
      const t = _ac.currentTime;
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(1750, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.001);   // sharp attack
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);  // quick decay → a tick
      o.connect(g); g.connect(_ac.destination);
      o.start(t); o.stop(t + 0.04);
    } catch(_){}
  }
  function tick(ms){
    clickSound();
    try { if(navigator.vibrate) navigator.vibrate(ms); } catch(_){}
  }

  // The active face's document, resolved by the shell (FACE_OVERLAYS stays private
  // to cube_shell.js). Null when nothing is open or the frame isn't ready.
  function activeDoc(){ return getActiveDoc(); }
  // The scrollable region varies per face: WATCH .scroll, FEED .body, BROWSE .bscroll.
  function scrollContainer(doc){
    return doc.querySelector('.scroll, .body, .bscroll') || doc.scrollingElement || doc.body;
  }
  function wheelScroll(dy){
    if(!getFocus().locked) return;                       // only acts on the OPEN face
    const doc = activeDoc(); if(!doc) return;
    const sc = scrollContainer(doc);
    if(sc) sc.scrollTop += dy;
  }
  // ── SELECT highlight cursor: a glowing outline that steps DOWN the open face's
  //    selectable buttons (one per SELECT tap, wraps at the bottom). Long-press
  //    SELECT to activate the highlighted button. A floating overlay in the face's
  //    own document glides between targets and re-glues itself on scroll. ──
  // Curated, per-face traversal order for the SELECT highlight. Each entry is a
  // GROUP (visited in order); within a group, elements are visited top→bottom,
  // left→right. So WATCH walks the open show's buttons → its episodes → the other
  // shows → tabs; LOG walks Start → mic → Finish → the rank chips → Note to Pierre.
  function faceGroups(){
    const activeFace = getFocus().face;
    if(activeFace === FACE_INDEX.log)        // WATCH face (cube_watch_face)
      return ['.exc-seas-chip',                                      // seasons (back from WATCH)
              '.exp-card [data-act="watch"]',                        // ▶ WATCH / WATCH AGAIN (start here)
              '.exp-card [data-act="share"], .exp-card [data-act="stop"]',
              '.vw-head, .ep-play, .ep-tix, .ep-share',              // episodes
              '.tile',                                               // the other shows
              '.addbtn, .tab'];
    if(activeFace === FACE_INDEX.episodes)   // LOG face (cube_log_face)
      return ['#startEpBtn, #micBtn, #finishEpBtn', // START/CONTINUE (start) · mic · FINISH
              '#svcCorner, .svc-lit, #epReadout',   // streamer (top-corner) + episode selector
              '.rank b',
              '#noteBtn'];
    if(activeFace === FACE_INDEX.feed)        // FEED (cube_feed_face)
      return ['.card'];
    if(activeFace === FACE_INDEX.join)        // BROWSE / JOIN (cube_browse_face)
      return ['.bcard, .res', '.join, #next, #back, #done, #signout, button'];
    return ['button, .tile, .tab, .vw-head, .crow, [role="button"]'];   // generic fallback
  }
  function faceSelectables(doc){
    const seen = new Set(), out = [];
    const cY = el => { const r = el.getBoundingClientRect(); return r.top + r.height/2; };
    for(const g of faceGroups()){
      const got = Array.prototype.slice.call(doc.querySelectorAll(g))
        .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0 && !el.disabled
                   && el.className !== 'wheel-hl' && !seen.has(el));
      // Cluster into ROWS by vertical center (so a wrapped grid like the season chips
      // reads 1,2,3 / 4,5,6 — not column-major — while a tall control like the mic
      // still shares START/FINISH's row), then order each row left→right.
      got.sort((a,b)=> cY(a) - cY(b));
      const rows = [];
      for(const el of got){
        const cy = cY(el), h = el.getBoundingClientRect().height, row = rows[rows.length-1];
        if(row && Math.abs(cy - row.cy) <= Math.max(h, row.h)/2 + 4){
          row.items.push(el); row.cy = (row.cy*row.n + cy)/(row.n+1); row.n++; row.h = Math.max(row.h, h);
        } else rows.push({ cy, h, n:1, items:[el] });
      }
      for(const row of rows){
        row.items.sort((a,b)=> a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        for(const el of row.items){ seen.add(el); out.push(el); }
      }
    }
    return out;
  }
  function ensureHL(doc){
    if(doc._wheelHL && doc.body.contains(doc._wheelHL)) return doc._wheelHL;
    const st = doc.createElement('style');
    st.textContent = '.wheel-hl{position:fixed;pointer-events:none;z-index:99999;border-radius:12px;'
      + 'outline:2px solid #f0a93b;box-shadow:0 0 0 3px rgba(240,169,59,.28),0 0 18px rgba(240,169,59,.55);'
      + 'transition:top .22s cubic-bezier(.34,1.3,.5,1),left .2s ease,width .18s ease,height .18s ease,opacity .15s;opacity:0}';
    doc.head.appendChild(st);
    const box = doc.createElement('div'); box.className = 'wheel-hl'; doc.body.appendChild(box);
    doc._wheelHL = box;
    const reflow = ()=>{ if(box._el && box.style.opacity !== '0'){ const r = box._el.getBoundingClientRect();
      box.style.top = r.top+'px'; box.style.left = r.left+'px'; box.style.width = r.width+'px'; box.style.height = r.height+'px'; } };
    const sc = scrollContainer(doc); if(sc) sc.addEventListener('scroll', reflow, {passive:true});
    if(doc.defaultView) doc.defaultView.addEventListener('scroll', reflow, {passive:true});
    return box;
  }
  function placeHL(doc, el){
    const box = ensureHL(doc); box._el = el;
    el.scrollIntoView({ block:'nearest', behavior:'smooth' });
    requestAnimationFrame(()=>{ const r = el.getBoundingClientRect();
      box.style.top = r.top+'px'; box.style.left = r.left+'px'; box.style.width = r.width+'px'; box.style.height = r.height+'px'; box.style.opacity = '1'; });
  }
  function hideHL(doc){ if(doc && doc._wheelHL) doc._wheelHL.style.opacity = '0'; }

  // SELECT toggles a highlight (selection) MODE. While on, the ring moves the
  // highlight between items instead of scrolling; SELECT confirms (activates) the
  // highlighted item and exits; a long-press cancels out of the mode.
  let selectMode = false;
  // Where the first SELECT click lands per face: WATCH on ▶ WATCH (back→seasons,
  // forward→the rest), LOG on START/CONTINUE. Others start at the first item.
  function faceStartIndex(doc, els){
    const activeFace = getFocus().face;
    let sel = null;
    if(activeFace === FACE_INDEX.log)            sel = '.exp-card [data-act="watch"]';
    else if(activeFace === FACE_INDEX.episodes) sel = '#startEpBtn';
    if(sel){ const el = doc.querySelector(sel); const i = el ? els.indexOf(el) : -1; if(i >= 0) return i; }
    return 0;
  }
  function enterSelect(){
    const doc = activeDoc(); if(!doc) return;
    const els = faceSelectables(doc); if(!els.length) return;
    selectMode = true;
    placeHL(doc, els[faceStartIndex(doc, els)]); tick(10);   // always begin at the face's start control
  }
  function moveSelect(dir){
    const doc = activeDoc(); if(!doc) return;
    const els = faceSelectables(doc); if(!els.length) return;
    const box = doc._wheelHL, cur = (box && box._el) ? els.indexOf(box._el) : -1;
    const next = ((cur < 0 ? (dir > 0 ? -1 : 0) : cur) + dir + els.length) % els.length;
    placeHL(doc, els[next]); tick(8);
  }
  function exitSelect(activate){
    const doc = activeDoc();
    if(activate && doc){ const box = doc._wheelHL; if(box && box._el){ box._el.click(); tick(18); } }
    selectMode = false;
    hideHL(doc);
  }

  // ── Open-dialogue scrub: when a picker overlay is open, the ring automatically
  //    scrubs its options (no need to arm select-mode). Episode sheet = a list of
  //    chips (highlight steps through them in order); streamer = a reel (the ring
  //    turns it back and forth). SELECT confirms; long-press cancels. ──
  function activeDialog(doc){
    if(!doc) return null;
    if(doc.querySelector('#epSheet.show'))
      return { type:'list', items(){ return Array.prototype.slice.call(doc.querySelectorAll('#epSheetGrid .epchip'))
                 .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0); },
               confirm(){ const b = doc._wheelHL; if(b && b._el){ b._el.click(); } },
               cancel(){ const x = doc.querySelector('#epSheetX'); if(x) x.click(); } };
    if(doc.querySelector('#svcWheel.show'))
      return { type:'reel',
               confirm(){ try { doc.defaultView.__reelSet(); } catch(_){} },
               cancel(){ const c = doc.querySelector('#svcCancel'); if(c) c.click(); } };
    return null;
  }
  function dialogStep(doc, dlg, dir){
    if(dlg.type === 'reel'){ try { doc.defaultView.__reelStep(dir); } catch(_){}; tick(8); return; }
    const items = dlg.items(); if(!items.length) return;           // list: highlight steps through chips
    const box = doc._wheelHL;
    let cur = (box && box._el) ? items.indexOf(box._el) : -1;
    if(cur < 0) cur = items.findIndex(el => el.classList.contains('cur'));   // start on the current chip
    if(cur < 0) cur = dir > 0 ? -1 : 0;
    placeHL(doc, items[(cur + dir + items.length) % items.length]); tick(8);
  }

  const SCROLL_PER_REV = 720;          // px scrolled per full finger revolution
  const STEP_NOTCH = 0.95;             // radians of rotation per highlight step (~54°) — bigger = less sensitive
  let cx=0, cy=0, lastAng=0, moved=0, sx=0, sy=0, active=false, stepAccum=0;
  const ang = (x,y)=>Math.atan2(y-cy, x-cx);

  ring.addEventListener('pointerdown', e=>{
    primeAudio();                                        // unlock iOS audio inside the gesture
    if(!getFocus().locked) selectMode = false;           // never carry select-mode across faces
    const r = ring.getBoundingClientRect();
    cx = r.left + r.width/2; cy = r.top + r.height/2;
    lastAng = ang(e.clientX, e.clientY); moved = 0; stepAccum = 0; sx = e.clientX; sy = e.clientY;
    active = true; try { ring.setPointerCapture(e.pointerId); } catch(_){}
    e.preventDefault();
  });
  ring.addEventListener('pointermove', e=>{
    if(!active) return;
    let a = ang(e.clientX, e.clientY), d = a - lastAng;
    if(d >  Math.PI) d -= 2*Math.PI;                     // wrap across ±π
    if(d < -Math.PI) d += 2*Math.PI;
    lastAng = a; moved += Math.abs(d);
    const dlg = getFocus().locked ? activeDialog(activeDoc()) : null;
    if(dlg){                                             // a picker is open → ring scrubs its options
      stepAccum += d;
      while(stepAccum >=  STEP_NOTCH){ dialogStep(activeDoc(), dlg, +1); stepAccum -= STEP_NOTCH; }
      while(stepAccum <= -STEP_NOTCH){ dialogStep(activeDoc(), dlg, -1); stepAccum += STEP_NOTCH; }
    } else if(selectMode){                               // ring drives the highlight, notch by notch
      stepAccum += d;
      while(stepAccum >=  STEP_NOTCH){ moveSelect(+1); stepAccum -= STEP_NOTCH; }   // clockwise → next/down
      while(stepAccum <= -STEP_NOTCH){ moveSelect(-1); stepAccum += STEP_NOTCH; }   // ccw → prev/up
    } else {
      wheelScroll((d / (2*Math.PI)) * SCROLL_PER_REV);   // clockwise → scroll down
    }
    e.preventDefault();
  });
  const end = () => { active = false; };   // ring: no edge actions (use SELECT + the highlight)
  ring.addEventListener('pointerup', end);
  ring.addEventListener('pointercancel', ()=>{ active = false; });

  // SELECT: tap to turn the highlight ON (ring then moves it); tap again to confirm
  // (activate the highlighted item) and exit; long-press to cancel out of the mode.
  if(center){
    let holdT = 0, held = false;
    center.addEventListener('pointerdown', e=>{
      primeAudio();                                      // unlock iOS audio inside the gesture
      if(!getFocus().locked) return;
      held = false;
      holdT = setTimeout(()=>{ held = true;              // long-press = cancel (dialogue → select-mode)
        const dlg = activeDialog(activeDoc());
        if(dlg){ dlg.cancel(); hideHL(activeDoc()); } else if(selectMode){ exitSelect(false); }
      }, 450);
      e.preventDefault();
    });
    const stop = ()=>{ if(holdT){ clearTimeout(holdT); holdT = 0;
      if(!held){                                         // tap = confirm dialogue / toggle select / activate
        const dlg = activeDialog(activeDoc());
        if(dlg){ dlg.confirm(); tick(18); hideHL(activeDoc()); }
        else selectMode ? exitSelect(true) : enterSelect();
      } } };
    center.addEventListener('pointerup', stop);
    center.addEventListener('pointercancel', ()=>{ if(holdT){ clearTimeout(holdT); holdT = 0; } });
    center.addEventListener('pointerleave', ()=>{ if(holdT){ clearTimeout(holdT); holdT = 0; } });
  }
})();
