// Собирает статистику для сайта заранее: мета и матчапы всех героев (OpenDota),
// роли, матчапы и синергии Divine–Immortal (STRATZ, если задан секрет STRATZ_TOKEN).
// Результат — data.json рядом с index.html; сайт читает его при открытии.
import { writeFile } from "node:fs/promises";

const OD = "https://api.opendota.com/api";
const SZ_URL = "https://api.stratz.com/graphql";
const SZ_BR = "DIVINE_IMMORTAL";
const SZ_BASE_Q = `query($b:[RankBracketBasicEnum]){ constants{ heroes{ id displayName } } heroStats{ stats(bracketBasicIds:$b, groupByPosition:true){ heroId position matchCount winCount } } }`;
const SZ_MU_Q = `query($h:Short!,$b:[RankBracketBasicEnum]){ heroStats{ matchUp(heroId:$h, bracketBasicIds:$b, take:200){ heroId vs{ heroId2 matchCount winCount } with{ heroId2 matchCount winCount } } } }`;
const OD_DELAY_MS = 1500;   // бесплатный OpenDota: до 60 запросов в минуту, берём с запасом
const SZ_DELAY_MS = 400;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, opt = {}, tries = 4) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, opt);
      if (r.ok) return await r.json();
      if (k >= tries || (r.status !== 429 && r.status < 500)) throw new Error(`${r.status} ${url}`);
    } catch (e) {
      if (k >= tries) throw e;
    }
    await sleep(5000 * k);
  }
}

async function openDota() {
  const heroStats = await getJson(`${OD}/heroStats`);
  const keep = ["id", "localized_name", "pro_pick", "pro_ban", "pro_win", "7_pick", "7_win", "8_pick", "8_win"];
  const stats = heroStats.map(h => Object.fromEntries(keep.map(k => [k, h[k] ?? 0])));
  const mu = {};
  for (const h of heroStats) {
    try {
      const d = await getJson(`${OD}/heroes/${h.id}/matchups`);
      mu[h.id] = d.map(x => [x.hero_id, x.games_played, x.wins]);
    } catch (e) { console.warn("OpenDota matchups", h.id, e.message); }
    await sleep(OD_DELAY_MS);
  }
  console.log(`OpenDota: ${stats.length} героев, матчапы для ${Object.keys(mu).length}`);
  return { heroStats: stats, mu };
}

async function stratz(token) {
  const q = (query, variables) => getJson(SZ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "User-Agent": "STRATZ_API" },
    body: JSON.stringify({ query, variables }),
  }).then(j => { if (j.errors?.length && !j.data) throw new Error(j.errors[0].message); return j.data; });
  const base = await q(SZ_BASE_Q, { b: [SZ_BR] });
  const mu = {};
  for (const h of base.constants.heroes) {
    try {
      const d = await q(SZ_MU_Q, { h: h.id, b: [SZ_BR] });
      const m = (d.heroStats.matchUp || []).find(x => x.heroId === h.id);
      if (m) mu[h.id] = { vs: m.vs.map(x => [x.heroId2, x.matchCount, x.winCount]), with: m.with.map(x => [x.heroId2, x.matchCount, x.winCount]) };
    } catch (e) { console.warn("STRATZ matchup", h.id, e.message); }
    await sleep(SZ_DELAY_MS);
  }
  console.log(`STRATZ: ${base.constants.heroes.length} героев, матчапы для ${Object.keys(mu).length}`);
  return { base, mu };
}

const out = { v: 1, updated: Date.now(), od: await openDota() };
const token = process.env.STRATZ_TOKEN;
if (token) {
  try { out.sz = await stratz(token); }
  catch (e) { console.warn("STRATZ пропущен:", e.message); }
} else console.log("STRATZ_TOKEN не задан — собираю только OpenDota");
await writeFile(new URL("../data.json", import.meta.url), JSON.stringify(out));
console.log("data.json записан");
