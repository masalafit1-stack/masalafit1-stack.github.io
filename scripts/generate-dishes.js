#!/usr/bin/env node

/*
 * Builds public, static dish pages from the private app data next door.
 * It deliberately writes rendered HTML only; nutrition source JSON is never
 * copied into this public repository.
 */

const fs = require('fs');
const path = require('path');

const SITE_ROOT = path.resolve(__dirname, '..');
const APP_ROOT = process.env.MASALAFIT_APP_DIR || path.resolve(SITE_ROOT, '..', 'DesICal');
const DISH_SOURCE = path.join(APP_ROOT, 'dishDatabase.json');
const OUTPUT_ROOT = path.join(SITE_ROOT, 'dishes');
const SITE_URL = 'https://masalafit.fit';
const APP_STORE_URL = 'https://apps.apple.com/app/id6763810759';
const PLAY_STORE_URL = '';
const APPLE_APP_ID = '6763810759';

function assertSourceExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dish data was not found at ${filePath}. Set MASALAFIT_APP_DIR to the app repository.`);
  }
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalize(value).replace(/\s+/g, '-');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatGrams(value) {
  const number = numberOrNull(value);
  return number === null ? 'Not available' : `${Number.isInteger(number) ? number : number.toFixed(1)} g`;
}

function formatCalories(value) {
  const number = numberOrNull(value);
  return number === null ? 'Not available' : `${Math.round(number)} cal`;
}

function hash(value) {
  return [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 7);
}

function joinNatural(values) {
  const clean = values.filter(Boolean);
  if (clean.length < 2) return clean[0] || '';
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean.at(-1)}`;
}

function getCanonicalDishes() {
  assertSourceExists(DISH_SOURCE);
  const primaryDishes = JSON.parse(fs.readFileSync(DISH_SOURCE, 'utf8'));
  if (!Array.isArray(primaryDishes)) {
    throw new Error('dishDatabase.json must contain an array.');
  }

  const canonicalNames = new Set();
  const knownTerms = new Set();
  const dishes = [];
  for (const dish of primaryDishes) {
    const name = String(dish?.name ?? '').trim();
    if (!name) continue;
    const canonicalKey = normalize(name);
    // An app entry can intentionally use another dish's alias in its own
    // canonical name. Only suppress exact canonical-name duplicates here;
    // aliases are reserved for de-duplicating separate regional source files.
    if (canonicalNames.has(canonicalKey)) continue;
    dishes.push({ ...dish, name });
    canonicalNames.add(canonicalKey);
    knownTerms.add(canonicalKey);
    for (const alias of dish.aliases ?? []) knownTerms.add(normalize(alias));
  }

  // Regional source files remain an input check, not a public copy. If a
  // future app export includes a genuinely new regional dish, include it once.
  const regionalFiles = fs.readdirSync(APP_ROOT)
    .filter((file) => file !== 'dishDatabase.json' && /Dishes\.json$/i.test(file))
    .sort();
  let mergedRegionalCount = 0;
  for (const file of regionalFiles) {
    const entries = JSON.parse(fs.readFileSync(path.join(APP_ROOT, file), 'utf8'));
    if (!Array.isArray(entries)) continue;
    for (const dish of entries) {
      const name = String(dish?.name ?? '').trim();
      if (!name || knownTerms.has(normalize(name))) continue;
      dishes.push({ ...dish, name });
      knownTerms.add(normalize(name));
      for (const alias of dish.aliases ?? []) knownTerms.add(normalize(alias));
      mergedRegionalCount += 1;
    }
  }

  return { dishes, regionalFiles, mergedRegionalCount };
}

function assignSlugs(dishes) {
  const used = new Map();
  return dishes
    .slice()
    .sort((first, second) => first.name.localeCompare(second.name))
    .map((dish) => {
      const base = slugify(dish.name) || 'dish';
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      return { ...dish, slug: count === 1 ? base : `${base}-${count}` };
    });
}

function getIntro(dish) {
  const serving = dish.servingSize || 'one serving';
  const rawDriver = String(dish.keyCalorieDrivers?.[0] || 'the cooking method and portion size').replace(/[.]+$/, '');
  const primaryDriver = rawDriver ? `${rawDriver.charAt(0).toLowerCase()}${rawDriver.slice(1)}` : 'the cooking method and portion size';
  const firstVariation = String(dish.variations?.[0] || '').replace(/[.]+$/, '');
  const templates = [
    `${dish.name} is shown as ${serving}, a typical ${dish.region || 'South Asian'} ${dish.category || 'dish'} portion. Its calories are particularly affected by ${primaryDriver}.`,
    `For ${serving} of ${dish.name}, this estimate starts with a familiar ${dish.region || 'South Asian'} preparation. The biggest day-to-day difference often comes from ${primaryDriver}.`,
    `This guide uses ${serving} of ${dish.name} as a practical logging reference. In this recipe, ${primaryDriver} is one of the details most likely to move the final calorie number.`,
    `MasalaFit’s ${dish.name} entry reflects a standard ${dish.region || 'South Asian'} serving of ${serving}. Compare your plate with the range below, especially when ${primaryDriver} differs from usual.`,
    `${dish.name} can vary substantially from kitchen to kitchen, so this page begins with ${serving}. The listed range helps account for differences such as ${primaryDriver}.`,
    `The nutrition here is for ${serving} of ${dish.name}, not an all-purpose restaurant portion. Pay closest attention to ${primaryDriver} when choosing the estimate that fits your meal.`,
  ];
  const intro = templates[hash(dish.name) % templates.length];
  return firstVariation ? `${intro} A common variation is ${firstVariation}.` : intro;
}

function getAliasSentence(dish) {
  const aliases = [...new Set((dish.aliases ?? [])
    .map((alias) => String(alias).trim())
    .filter((alias) => alias && normalize(alias) !== normalize(dish.name)))].slice(0, 5);
  return aliases.length ? ` You may also see it described as ${joinNatural(aliases)}.` : '';
}

function getRelatedDishes(dish, allDishes) {
  return allDishes
    .filter((candidate) => candidate.slug !== dish.slug)
    .map((candidate) => ({
      candidate,
      score: (candidate.region === dish.region ? 3 : 0) + (candidate.category === dish.category ? 2 : 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score || first.candidate.name.localeCompare(second.candidate.name))
    .slice(0, 6)
    .map(({ candidate }) => candidate);
}

function rangeRows(dish) {
  const rows = [
    ['Low-oil preparation', dish.lowOilCalories],
    ['Typical preparation', dish.baseCalories],
    ['Higher-oil preparation', dish.highOilCalories],
  ].filter(([, calories]) => numberOrNull(calories) !== null);
  if (numberOrNull(dish.restaurantMin) !== null && numberOrNull(dish.restaurantMax) !== null) {
    rows.push(['Restaurant estimate', `${formatCalories(dish.restaurantMin)}–${formatCalories(dish.restaurantMax)}`]);
  }
  return rows;
}

function storeCtaMarkup() {
  return `<a class="store-button" id="store-cta" href="${APP_STORE_URL}" target="_blank" rel="noopener">Track this dish in MasalaFit <span>on the App Store</span></a>
  <script>
    const APP_STORE_URL = ${escapeJson(APP_STORE_URL)};
    const PLAY_STORE_URL = ${escapeJson(PLAY_STORE_URL)};
    const storeCta = document.getElementById('store-cta');
    if (/Android/i.test(navigator.userAgent)) {
      if (PLAY_STORE_URL) {
        storeCta.href = PLAY_STORE_URL;
        storeCta.innerHTML = 'Track this dish in MasalaFit <span>on Google Play</span>';
      } else {
        const notice = document.createElement('span');
        notice.className = 'android-notice';
        notice.textContent = 'Android coming soon';
        storeCta.replaceWith(notice);
      }
    }
  </script>`;
}

const pageStyles = `
  :root { --cream:#FAF6EE; --ink:#251b16; --muted:#705f55; --spice:#C4531A; --line:#E6D6C6; --card:#fffaf4; }
  * { box-sizing:border-box; } body { margin:0; background:var(--cream); color:var(--ink); font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; line-height:1.55; }
  a { color:var(--spice); } .wrap { width:min(100% - 32px,960px); margin:auto; } header { border-bottom:1px solid var(--line); padding:20px 0; } .brand { color:var(--spice); font-family:Fraunces,Georgia,serif; font-size:1.55rem; font-weight:900; text-decoration:none; } nav { float:right; margin-top:6px; } nav a { font-weight:700; text-decoration:none; }
  main { padding:48px 0 64px; } .eyebrow { color:var(--spice); font-size:.76rem; font-weight:800; letter-spacing:.09em; text-transform:uppercase; } h1,h2,h3 { font-family:Fraunces,Georgia,serif; letter-spacing:0; } h1 { font-size:clamp(2.2rem,6vw,4rem); line-height:1.04; margin:10px 0 18px; overflow-wrap:anywhere; } h2 { font-size:1.5rem; margin:0 0 12px; } .lead { color:var(--muted); font-size:1.08rem; max-width:740px; overflow-wrap:anywhere; } .grid { display:grid; gap:16px; grid-template-columns:repeat(4,minmax(0,1fr)); margin:34px 0; } .stat,.section { border:1px solid var(--line); border-radius:10px; background:var(--card); } .stat { padding:18px; } .stat strong { display:block; color:var(--spice); font-size:1.45rem; overflow-wrap:anywhere; } .stat span { color:var(--muted); font-size:.88rem; } .section { padding:24px; margin-top:18px; } .range { width:100%; border-collapse:collapse; } .range td { border-top:1px solid var(--line); padding:11px 0; overflow-wrap:anywhere; } .range td:last-child { color:var(--spice); font-weight:800; text-align:right; } ul { margin:0; padding-left:20px; } li + li { margin-top:7px; } .estimate { color:var(--muted); font-size:.94rem; } .related { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; list-style:none; padding:0; } .related a { display:block; height:100%; padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--cream); color:var(--ink); font-weight:700; overflow-wrap:anywhere; text-decoration:none; } .store-button,.android-notice { display:inline-flex; flex-direction:column; align-items:center; background:var(--spice); color:var(--cream); border-radius:8px; margin-top:26px; padding:14px 24px; font-weight:800; text-align:center; text-decoration:none; } .store-button span { font-size:.78rem; font-weight:500; margin-top:2px; } .android-notice { background:#715f54; } footer { border-top:1px solid var(--line); color:var(--muted); font-size:.9rem; padding:24px 0 40px; } @media (max-width:640px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .related { grid-template-columns:1fr; } nav { float:none; margin-top:10px; } }
`;

function renderDishPage(dish, allDishes) {
  const pageUrl = `${SITE_URL}/dishes/${dish.slug}/`;
  const serving = dish.servingSize || 'one serving';
  const title = `Calories in ${dish.name} (${serving}) | MasalaFit`;
  const description = `${formatCalories(dish.baseCalories)} in ${serving} of ${dish.name}, with protein, carbs, fat, cooking ranges, and serving notes from MasalaFit.`;
  const related = getRelatedDishes(dish, allDishes);
  const nutrition = {
    '@type': 'NutritionInformation',
    calories: `${Math.round(numberOrNull(dish.baseCalories) ?? 0)} calories`,
    proteinContent: `${numberOrNull(dish.protein) ?? 0} g`,
    carbohydrateContent: `${numberOrNull(dish.carbs) ?? 0} g`,
    fatContent: `${numberOrNull(dish.fat) ?? 0} g`,
    servingSize: serving,
  };
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `Calories in ${dish.name}`,
    description,
    mainEntityOfPage: pageUrl,
    about: {
      '@type': 'MenuItem',
      name: dish.name,
      nutrition,
    },
    author: { '@type': 'Organization', name: 'MasalaFit', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'MasalaFit', url: SITE_URL },
  };
  const calorieRows = rangeRows(dish)
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${typeof value === 'string' ? escapeHtml(value) : formatCalories(value)}</td></tr>`)
    .join('');
  const drivers = (dish.keyCalorieDrivers ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Preparation and portion size can change the estimate.</li>';
  const variations = (dish.variations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Use the serving and preparation that best match your plate.</li>';
  const relatedMarkup = related.length
    ? related.map((candidate) => `<li><a href="/dishes/${encodeURIComponent(candidate.slug)}/">${escapeHtml(candidate.name)}</a></li>`).join('')
    : '<li>No related dishes available yet.</li>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="apple-itunes-app" content="app-id=${APPLE_APP_ID}">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="MasalaFit">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${pageUrl}">
  <meta name="twitter:card" content="summary">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
  <style>${pageStyles}</style>
  <script type="application/ld+json">${escapeJson(structuredData)}</script>
</head>
<body>
  <header><div class="wrap"><a class="brand" href="/">MasalaFit</a><nav><a href="/dishes/">Browse dishes</a></nav></div></header>
  <main class="wrap">
    <p class="eyebrow">${escapeHtml(dish.region || 'South Asian')} · ${escapeHtml(dish.category || 'Dish')}</p>
    <h1>Calories in ${escapeHtml(dish.name)} (${escapeHtml(serving)})</h1>
    <p class="lead">${escapeHtml(getIntro(dish) + getAliasSentence(dish))}</p>
    <section class="grid" aria-label="Nutrition for one serving">
      <div class="stat"><strong>${formatCalories(dish.baseCalories)}</strong><span>Calories</span></div>
      <div class="stat"><strong>${formatGrams(dish.protein)}</strong><span>Protein</span></div>
      <div class="stat"><strong>${formatGrams(dish.carbs)}</strong><span>Carbs</span></div>
      <div class="stat"><strong>${formatGrams(dish.fat)}</strong><span>Fat</span></div>
    </section>
    <section class="section"><h2>Calorie range</h2><table class="range"><tbody>${calorieRows}</tbody></table></section>
    <section class="section"><h2>What drives the calories</h2><ul>${drivers}</ul></section>
    <section class="section"><h2>Variations</h2><ul>${variations}</ul></section>
    <section class="section"><h2>Related dishes</h2><ul class="related">${relatedMarkup}</ul></section>
    <p class="estimate">Nutrition values are estimates for the serving shown. Recipes, cooking fat, restaurant portions, and accompaniments can change the final calories and macros.</p>
    ${storeCtaMarkup()}
  </main>
  <footer><div class="wrap">MasalaFit helps you track the South Asian food you actually eat. <a href="/dishes/">Explore all dishes</a>.</div></footer>
</body>
</html>`;
}

function renderDishIndex(dishes) {
  const groups = new Map();
  for (const dish of dishes) {
    const region = dish.region || 'Other South Asian dishes';
    const category = dish.category || 'Other dishes';
    if (!groups.has(region)) groups.set(region, new Map());
    if (!groups.get(region).has(category)) groups.get(region).set(category, []);
    groups.get(region).get(category).push(dish);
  }
  const sections = [...groups.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([region, categories]) => `<section class="section"><h2>${escapeHtml(region)}</h2>${[...categories.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([category, entries]) => `<h3>${escapeHtml(category)}</h3><ul class="dish-list">${entries
        .sort((first, second) => first.name.localeCompare(second.name))
        .map((dish) => `<li><a href="/dishes/${encodeURIComponent(dish.slug)}/">${escapeHtml(dish.name)}</a><span>${formatCalories(dish.baseCalories)} · ${escapeHtml(dish.servingSize || 'one serving')}</span></li>`)
        .join('')}</ul>`).join('')}</section>`)
    .join('');
  const indexStyles = `${pageStyles}\n.dish-list { columns:2; list-style:none; padding:0; } .dish-list li { break-inside:avoid; border-top:1px solid var(--line); padding:9px 0; } .dish-list a { color:var(--ink); font-weight:700; text-decoration:none; } .dish-list span { color:var(--muted); display:block; font-size:.87rem; } h3 { color:var(--spice); font-size:1.15rem; margin:24px 0 7px; } @media (max-width:640px) { .dish-list { columns:1; } }`;
  const title = 'South Asian Food Calories by Dish | MasalaFit';
  const description = `Browse calories and nutrition estimates for ${dishes.length} South Asian dishes, grouped by region and category.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="apple-itunes-app" content="app-id=${APPLE_APP_ID}"><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${SITE_URL}/dishes/"><meta property="og:type" content="website"><meta property="og:site_name" content="MasalaFit"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${SITE_URL}/dishes/"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet"><style>${indexStyles}</style></head><body><header><div class="wrap"><a class="brand" href="/">MasalaFit</a><nav><a href="/">Home</a></nav></div></header><main class="wrap"><p class="eyebrow">Desi food calorie guide</p><h1>Browse South Asian dishes</h1><p class="lead">Explore serving-based calorie and macro estimates for dishes in the MasalaFit directory. Values are estimates and vary with portion and preparation.</p>${sections}${storeCtaMarkup()}</main><footer><div class="wrap">MasalaFit helps you track the South Asian food you actually eat.</div></footer></body></html>`;
}

function buildSitemap(dishes) {
  const urls = [`${SITE_URL}/`, `${SITE_URL}/dishes/`, ...dishes.map((dish) => `${SITE_URL}/dishes/${dish.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}\n</urlset>\n`;
}

function main() {
  const { dishes: sourceDishes, regionalFiles, mergedRegionalCount } = getCanonicalDishes();
  const dishes = assignSlugs(sourceDishes);
  fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  for (const dish of dishes) {
    const dishDirectory = path.join(OUTPUT_ROOT, dish.slug);
    fs.mkdirSync(dishDirectory, { recursive: true });
    fs.writeFileSync(path.join(dishDirectory, 'index.html'), renderDishPage(dish, dishes));
  }
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'index.html'), renderDishIndex(dishes));
  fs.writeFileSync(path.join(SITE_ROOT, 'sitemap.xml'), buildSitemap(dishes));
  fs.writeFileSync(path.join(SITE_ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  console.log(`Generated ${dishes.length} dish pages from dishDatabase.json.`);
  console.log(`Checked ${regionalFiles.length} regional JSON files; added ${mergedRegionalCount} non-duplicate dishes.`);
}

main();
