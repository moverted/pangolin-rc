// ─── pierre_skill_premiere_timing ────────────────────────────────────────────
//
// When does an episode ACTUALLY become available, and what is that in the
// member's own timezone? TVmaze's `airstamp` (a full instant) is authoritative
// when we have it — but only a date-only `airdate` survives for many rows, and a
// date has no time. This module encodes each streamer's real drop convention so a
// bare airdate can still resolve to a true instant, then renders it in the user's
// local zone.
//
// The rules are US-anchored (that is where the release calendars are set) and
// expressed as {zone, time, dayOffset}: the wall-clock moment, in a specific US
// (or GMT) zone, relative to the listed airdate. Converting that wall-clock to a
// real UTC instant is DST-aware (Intl), and from there it renders in any zone.
//
// Sources (member-provided, 2026-09):
//   Netflix ............ 12:00 AM PT (global)
//   Disney+ ............ 12:00 AM PT (Wed, or Fri for select series)
//   Hulu ............... 12:00 AM ET (next-day network eps; originals 12–3 AM ET)
//   Max (originals) .... 3:00 AM ET = 12:00 AM PT on premiere day
//   HBO (flagship) ..... 9:00 PM ET / 6:00 PM PT — Sunday-night cable simulcast
//   Prime Video ........ ~midnight PT (often the evening before; inconsistent)
//   Apple TV+ .......... 12:00 AM GMT → U.S. gets it the evening BEFORE the date

export type ReleaseZone = 'America/New_York' | 'America/Los_Angeles' | 'UTC';

export interface ReleaseRule {
  zone: ReleaseZone;
  hour: number;      // 0–23, wall-clock hour in `zone`
  minute: number;
  dayOffset: number; // days from the listed airdate (Apple's GMT-midnight lands the U.S. a day early)
  label: string;     // human note, for Pierre / debugging
}

// The HBO/Max split is the one that matters: TVmaze lists flagship cable series
// (House of the Dragon, The Last of Us, Lanterns) under the NETWORK "HBO" and they
// simulcast at 9pm ET; Max-original streaming series list under the WEBCHANNEL
// "Max" and drop at 3am ET / midnight PT. So "HBO" and "Max" get different rules.
const HBO_FLAGSHIP: ReleaseRule = { zone: 'America/New_York', hour: 21, minute: 0, dayOffset: 0, label: '9:00 PM ET (HBO cable simulcast)' };
const MIDNIGHT_PT: ReleaseRule = { zone: 'America/Los_Angeles', hour: 0, minute: 0, dayOffset: 0, label: '12:00 AM PT' };
const MIDNIGHT_ET: ReleaseRule = { zone: 'America/New_York', hour: 0, minute: 0, dayOffset: 0, label: '12:00 AM ET' };
const APPLE: ReleaseRule = { zone: 'UTC', hour: 0, minute: 0, dayOffset: 0, label: '12:00 AM GMT (U.S. gets it the evening before)' };

// Fallback for an unknown / non-streaming platform: the end of the airdate, US
// Eastern. Mirrors the SQL `airdate 23:59:59` fallback used for the released count.
const UNKNOWN: ReleaseRule = { zone: 'America/New_York', hour: 23, minute: 59, dayOffset: 0, label: 'end of airdate (unknown platform)' };

// Normalize a catalog `platform` string (TVmaze network/webChannel name) to a rule.
// Matching is loose (lowercased substring) so "HBO", "Max", "Disney+", "Apple TV+",
// "Amazon Prime Video" etc. all resolve.
export function ruleForPlatform(platform: string | null | undefined): ReleaseRule {
  const p = (platform || '').toLowerCase().trim();
  if (!p) return UNKNOWN;
  if (p.includes('apple')) return APPLE;
  if (p.includes('netflix')) return MIDNIGHT_PT;
  if (p.includes('disney')) return MIDNIGHT_PT;
  if (p.includes('prime') || p.includes('amazon')) return MIDNIGHT_PT;
  if (p.includes('hulu')) return MIDNIGHT_ET;
  // Max originals stream at 3am ET / midnight PT; flagship HBO cable simulcasts at 9pm ET.
  if (p === 'max' || p.includes('hbo max')) return MIDNIGHT_PT;
  if (p.includes('hbo')) return HBO_FLAGSHIP;
  return UNKNOWN;
}

// Wall-clock (y,mo,d,h,mi) in `zone` → real UTC epoch ms, DST-aware. Guess the
// instant as if the wall-clock were UTC, measure how far `zone` actually sits from
// UTC at that instant, correct, and correct once more to settle DST-boundary cases.
function zonedWallToEpoch(y: number, mo: number, d: number, h: number, mi: number, zone: ReleaseZone): number {
  if (zone === 'UTC') return Date.UTC(y, mo - 1, d, h, mi);
  const target = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (epoch: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(epoch)).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
    const asUTC = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
    return asUTC - epoch; // ms that `zone` leads UTC at this instant
  };
  let epoch = target - offsetAt(target);
  epoch = target - offsetAt(epoch); // second pass settles the DST edge
  return epoch;
}

// Apply a rule to a listed airdate → real UTC instant. Null when the date is unusable.
function ruleEpoch(rule: ReleaseRule, airdate: string | null | undefined): number | null {
  if (!airdate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(airdate);
  if (!m) return null;
  let base = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  if (rule.dayOffset) base += rule.dayOffset * 86400000;
  const b = new Date(base);
  return zonedWallToEpoch(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate(), rule.hour, rule.minute, rule.zone);
}

// The best-known drop instant (UTC epoch ms), and where it came from. Resolution order:
//   1. A KNOWN streamer rule wins — even over a TVmaze airstamp, because TVmaze often
//      timestamps a streamer episode at the listed date's midnight (or noon) in a US zone,
//      which is wrong for e.g. Apple (12am GMT → the U.S. gets it the evening BEFORE). The
//      rule is the member-verified convention.
//   2. Else the raw TVmaze airstamp — precise for cable/broadcast (real airtime), where we
//      have no streamer rule.
//   3. Else the UNKNOWN fallback (end of the airdate, US Eastern).
export function resolveDrop(
  platform: string | null | undefined,
  airdate: string | null | undefined,
  airstamp?: string | null,
): { epoch: number; source: 'platform-rule' | 'airstamp'; rule: string } | null {
  const rule = ruleForPlatform(platform);
  if (rule !== UNKNOWN) {
    const e = ruleEpoch(rule, airdate);
    if (e != null) return { epoch: e, source: 'platform-rule', rule: rule.label };
  }
  if (airstamp) { const t = new Date(airstamp).getTime(); if (!Number.isNaN(t)) return { epoch: t, source: 'airstamp', rule: 'TVmaze airstamp' }; }
  const e = ruleEpoch(UNKNOWN, airdate);
  return e != null ? { epoch: e, source: 'platform-rule', rule: UNKNOWN.label } : null;
}

// The best-known drop instant (UTC epoch ms) only, or null.
export function dropEpoch(
  platform: string | null | undefined,
  airdate: string | null | undefined,
  airstamp?: string | null,
): number | null {
  const r = resolveDrop(platform, airdate, airstamp);
  return r ? r.epoch : null;
}

// ISO string of the best-known drop instant — what the catalog stores in `airstamp`.
export function dropStampISO(
  platform: string | null | undefined,
  airdate: string | null | undefined,
  airstamp?: string | null,
): string | null {
  const e = dropEpoch(platform, airdate, airstamp);
  return e == null ? null : new Date(e).toISOString();
}

// Has an episode dropped yet, in the member's real availability window?
export function hasDropped(
  platform: string | null | undefined,
  airdate: string | null | undefined,
  airstamp: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const e = dropEpoch(platform, airdate, airstamp);
  return e != null && e <= now;
}

// Render a drop instant in the member's timezone as a warm, Pierre-ready phrase:
// "tonight at 6:00 PM", "tomorrow at 9:00 PM", or "Fri, Sep 12 at 12:00 AM".
// `timeZone` is an IANA name (Intl.DateTimeFormat().resolvedOptions().timeZone).
export function describeLocal(epoch: number, timeZone: string, now: number = Date.now()): string {
  const tz = safeZone(timeZone);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(epoch));
  const dayKey = (e: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e));
  const today = dayKey(now), drop = dayKey(epoch), tomorrow = dayKey(now + 86400000);
  const past = epoch <= now;
  if (drop === today) return past ? `earlier today at ${time}` : `tonight at ${time}`;
  if (!past && drop === tomorrow) return `tomorrow at ${time}`;
  const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(epoch));
  return `${date} at ${time}`;
}

// A structured answer for the Pierre tool: the instant, its local phrasing, and
// which rule fired (so Pierre can be honest about a guess vs. a confirmed time).
export function premiereTiming(
  platform: string | null | undefined,
  airdate: string | null | undefined,
  timeZone: string,
  airstamp?: string | null,
  now: number = Date.now(),
): { epoch: number; iso: string; local: string; dropped: boolean; source: 'airstamp' | 'platform-rule'; rule: string } | null {
  const r = resolveDrop(platform, airdate, airstamp);
  if (!r) return null;
  return {
    epoch: r.epoch, iso: new Date(r.epoch).toISOString(),
    local: describeLocal(r.epoch, timeZone, now),
    dropped: r.epoch <= now,
    source: r.source,
    rule: r.rule,
  };
}

// Guard: an untrusted IANA zone string would throw inside Intl. Fall back to ET.
function safeZone(tz: string): string {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  catch { return 'America/New_York'; }
}
