import { mkdir, writeFile } from "node:fs/promises";

const username = "Abraao-SPX";
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const outputDirectory = new URL("../../assets/", import.meta.url);

const requestHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${username}-profile-assets`,
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const languageColors = {
  JavaScript: "#f7df1e",
  TypeScript: "#3178c6",
  Python: "#3776ab",
  Java: "#f89820",
  Dart: "#00b4ab",
  HTML: "#e34f26",
  CSS: "#663399",
  "C#": "#9b4f96",
  C: "#a8b9cc",
  "C++": "#00599c",
  PHP: "#777bb4",
  Shell: "#89e051",
  Kotlin: "#a97bff",
  Swift: "#f05138",
  Vue: "#41b883",
};

async function request(url, type = "json") {
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) {
    throw new Error(`${response.status} ao consultar ${url}`);
  }
  return type === "text" ? response.text() : response.json();
}

async function getRepositories() {
  const repositories = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await request(
      `https://api.github.com/users/${username}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
    );
    repositories.push(...batch);
    if (batch.length < 100) break;
  }
  return repositories.filter((repository) => !repository.fork);
}

async function getLanguages(repositories) {
  const totals = new Map();
  const results = await Promise.allSettled(
    repositories.map((repository) => request(repository.languages_url)),
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      Object.entries(result.value).forEach(([language, bytes]) => {
        totals.set(language, (totals.get(language) || 0) + bytes);
      });
      return;
    }

    const repository = repositories[index];
    if (repository.language) {
      totals.set(
        repository.language,
        (totals.get(repository.language) || 0) + Math.max(repository.size, 1),
      );
    }
  });

  const totalBytes = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const languages = [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, bytes]) => ({
      name,
      percentage: totalBytes ? (bytes / totalBytes) * 100 : 0,
      color: languageColors[name] || "#94a3b8",
    }));

  const featured = languages.slice(0, 4);
  const otherPercentage = languages
    .slice(4)
    .reduce((sum, language) => sum + language.percentage, 0);
  if (otherPercentage >= 0.1) {
    featured.push({ name: "Outras", percentage: otherPercentage, color: "#475569" });
  }
  return featured;
}

async function getContributionCalendar() {
  const html = await request(
    `https://github.com/users/${username}/contributions`,
    "text",
  );
  const totalMatch = html.match(/([\d.,]+)\s+contributions?\s+in the last year/i);
  const days = [];

  for (const match of html.matchAll(/<td\b[^>]*ContributionCalendar-day[^>]*>/g)) {
    const tag = match[0];
    const date = tag.match(/data-date="([^"]+)"/)?.[1];
    const level = Number(tag.match(/data-level="([0-4])"/)?.[1]);
    if (date && Number.isInteger(level)) days.push({ date, level });
  }

  if (!days.length) throw new Error("O calendario de contribuicoes veio vazio.");

  return {
    total: totalMatch ? Number(totalMatch[1].replace(/[.,]/g, "")) : 0,
    days: days.sort((left, right) => left.date.localeCompare(right.date)),
  };
}

function calculateStreaks(days) {
  let longest = 0;
  let running = 0;
  for (const day of days) {
    running = day.level > 0 ? running + 1 : 0;
    longest = Math.max(longest, running);
  }

  let current = 0;
  let cursor = days.length - 1;
  if (days[cursor]?.level === 0) cursor -= 1;
  while (cursor >= 0 && days[cursor].level > 0) {
    current += 1;
    cursor -= 1;
  }
  return { current, longest };
}

function compactNumber(value) {
  if (typeof value !== "number") return String(value);
  if (value < 1_000) return String(value);
  return `${(value / 1_000).toFixed(1).replace(".", ",")}k`;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sharedDefinitions(id) {
  return `
    <defs>
      <linearGradient id="${id}-background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b0d16"/>
        <stop offset="0.52" stop-color="#111426"/>
        <stop offset="1" stop-color="#0b1220"/>
      </linearGradient>
      <linearGradient id="${id}-accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#7c3aed"/>
        <stop offset="0.52" stop-color="#a855f7"/>
        <stop offset="1" stop-color="#22d3ee"/>
      </linearGradient>
      <radialGradient id="${id}-aura" cx="0" cy="0" r="1" gradientTransform="translate(760 10) rotate(145) scale(390 240)">
        <stop stop-color="#7c3aed" stop-opacity=".2"/>
        <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
      </radialGradient>
      <pattern id="${id}-grid" width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M28 0H0V28" fill="none" stroke="#ffffff" stroke-opacity=".025"/>
      </pattern>
      <filter id="${id}-glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;
}

function renderStats({ user, languages, calendar }) {
  const { current } = calculateStreaks(calendar.days);
  const metrics = [
    ["CONTRIBUIÇÕES · 12 MESES", calendar.total],
    ["SEQUÊNCIA ATUAL", `${current} dias`],
    ["REPOSITÓRIOS PÚBLICOS", user.public_repos],
  ];

  const cards = metrics
    .map(([label, value], index) => {
      const x = 38 + index * 295;
      return `
        <g transform="translate(${x} 82)">
          <rect width="281" height="91" rx="14" fill="#ffffff" fill-opacity=".035" stroke="#ffffff" stroke-opacity=".09"/>
          <rect x="16" y="16" width="25" height="3" rx="1.5" fill="url(#stats-accent)"/>
          <text x="16" y="57" class="metric">${xml(compactNumber(value))}</text>
          <text x="16" y="77" class="label">${label}</text>
        </g>`;
    })
    .join("");

  let segmentX = 39;
  const barWidth = 882;
  const languageSegments = languages
    .map((language, index) => {
      const width =
        index === languages.length - 1
          ? 39 + barWidth - segmentX
          : Math.max((language.percentage / 100) * barWidth, 4);
      const segment = `<rect x="${segmentX.toFixed(1)}" y="211" width="${width.toFixed(1)}" height="8" rx="4" fill="${language.color}"/>`;
      segmentX += width + 2;
      return segment;
    })
    .join("");

  const languageLabels = languages
    .map((language, index) => {
      const x = 39 + index * (882 / Math.max(languages.length, 1));
      return `
        <g transform="translate(${x.toFixed(1)} 246)">
          <circle cx="5" cy="-4" r="4" fill="${language.color}"/>
          <text x="16" class="language">${xml(language.name)}</text>
          <text x="16" y="17" class="percentage">${language.percentage.toFixed(1).replace(".", ",")}%</text>
        </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="294" viewBox="0 0 960 294" role="img" aria-labelledby="title description">
    <title id="title">Painel GitHub de Abraão Paixão</title>
    <desc id="description">Resumo de contribuições, sequência atual, repositórios e linguagens mais utilizadas.</desc>
    ${sharedDefinitions("stats")}
    <style>
      text{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
      .eyebrow{fill:#a78bfa;font-size:11px;font-weight:700;letter-spacing:2px}
      .heading{fill:#f8fafc;font-size:21px;font-weight:750;letter-spacing:-.3px}
      .subheading{fill:#64748b;font-size:11px;letter-spacing:1px}
      .metric{fill:#f8fafc;font-size:27px;font-weight:750;letter-spacing:-1px}
      .label{fill:#8b93a7;font-size:9px;font-weight:700;letter-spacing:1.3px}
      .language{fill:#dbe2ef;font-size:11px;font-weight:650}
      .percentage{fill:#667085;font-size:9px;font-weight:600}
      .live{animation:pulse 2.4s ease-in-out infinite}
      @keyframes pulse{50%{opacity:.35}}
      @media(prefers-reduced-motion:reduce){.live{animation:none}}
    </style>
    <rect x="1" y="1" width="958" height="292" rx="22" fill="url(#stats-background)" stroke="#7c3aed" stroke-opacity=".32"/>
    <rect x="1" y="1" width="958" height="292" rx="22" fill="url(#stats-aura)"/>
    <rect x="1" y="1" width="958" height="292" rx="22" fill="url(#stats-grid)"/>
    <rect x="2" y="2" width="956" height="3" rx="1.5" fill="url(#stats-accent)" opacity=".9"/>
    <g transform="translate(39 31)">
      <rect width="38" height="38" rx="11" fill="#7c3aed" fill-opacity=".17" stroke="#a78bfa" stroke-opacity=".42"/>
      <text x="19" y="25" text-anchor="middle" fill="#c4b5fd" font-size="14" font-weight="800">AP</text>
      <text x="53" y="13" class="eyebrow">GITHUB // DEV SIGNAL</text>
      <text x="53" y="35" class="heading">Abraão Paixão</text>
    </g>
    <g transform="translate(764 46)">
      <circle class="live" cx="0" cy="0" r="7" fill="#22d3ee" fill-opacity=".16"/>
      <circle cx="0" cy="0" r="3" fill="#22d3ee" filter="url(#stats-glow)"/>
      <text x="14" y="4" class="subheading">FULL STACK · AO VIVO</text>
    </g>
    ${cards}
    <text x="39" y="198" class="eyebrow">LINGUAGENS EM DESTAQUE</text>
    <rect x="39" y="211" width="882" height="8" rx="4" fill="#ffffff" fill-opacity=".045"/>
    ${languageSegments}
    ${languageLabels}
  </svg>`;
}

function renderContributions({ days, total }) {
  const { current, longest } = calculateStreaks(days);
  const cellColors = ["#20243a", "#34205f", "#5426a5", "#7c3aed", "#22d3ee"];
  const start = new Date(`${days[0].date}T00:00:00Z`);
  const heatmapX = 120;
  const heatmapY = 91;
  const step = 13;

  const cells = days
    .map((day) => {
      const date = new Date(`${day.date}T00:00:00Z`);
      const difference = Math.round((date - start) / 86_400_000);
      const week = Math.floor(difference / 7);
      const weekday = date.getUTCDay();
      const x = heatmapX + week * step;
      const y = heatmapY + weekday * step;
      const hotClass = day.level === 4 ? ' class="hot"' : "";
      return `<rect${hotClass} x="${x}" y="${y}" width="9" height="9" rx="2.2" fill="${cellColors[day.level]}" data-date="${day.date}"/>`;
    })
    .join("");

  const monthNames = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const shownMonths = new Set();
  const months = [];
  for (const day of days) {
    const date = new Date(`${day.date}T00:00:00Z`);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (date.getUTCDate() <= 7 && !shownMonths.has(key)) {
      const difference = Math.round((date - start) / 86_400_000);
      const x = heatmapX + Math.floor(difference / 7) * step;
      if (x < 895) months.push(`<text x="${x}" y="79" class="month">${monthNames[date.getUTCMonth()]}</text>`);
      shownMonths.add(key);
    }
  }

  const legend = cellColors
    .map((color, index) => `<rect x="${820 + index * 15}" y="236" width="9" height="9" rx="2" fill="${color}"${index === 4 ? ' filter="url(#contrib-glow)"' : ""}/>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="268" viewBox="0 0 960 268" role="img" aria-labelledby="title description">
    <title id="title">Constelação de contribuições de Abraão Paixão</title>
    <desc id="description">Mapa das contribuições realizadas nos últimos 365 dias.</desc>
    ${sharedDefinitions("contrib")}
    <style>
      text{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
      .eyebrow{fill:#a78bfa;font-size:11px;font-weight:750;letter-spacing:2px}
      .total{fill:#f8fafc;font-size:24px;font-weight:760;letter-spacing:-.5px}
      .small{fill:#687189;font-size:9px;font-weight:650;letter-spacing:1px}
      .month,.day{fill:#566078;font-size:8px;font-weight:650;letter-spacing:.6px}
      .streak-value{fill:#e2e8f0;font-size:13px;font-weight:750}
      .streak-label{fill:#646e84;font-size:8px;font-weight:700;letter-spacing:1px}
      .hot{filter:url(#contrib-glow);animation:star 3s ease-in-out infinite}
      .beam{animation:beam 7s ease-in-out infinite}
      @keyframes star{50%{opacity:.55}}
      @keyframes beam{0%,100%{opacity:.25}50%{opacity:.8}}
      @media(prefers-reduced-motion:reduce){.hot,.beam{animation:none}}
    </style>
    <rect x="1" y="1" width="958" height="266" rx="22" fill="url(#contrib-background)" stroke="#7c3aed" stroke-opacity=".32"/>
    <rect x="1" y="1" width="958" height="266" rx="22" fill="url(#contrib-aura)"/>
    <rect x="1" y="1" width="958" height="266" rx="22" fill="url(#contrib-grid)"/>
    <rect x="2" y="2" width="956" height="3" rx="1.5" fill="url(#contrib-accent)" opacity=".9"/>
    <g transform="translate(39 31)">
      <path d="M0 13C9 1 19 1 28 13C19 25 9 25 0 13Z" fill="#7c3aed" fill-opacity=".16" stroke="#a78bfa" stroke-opacity=".35"/>
      <circle cx="14" cy="13" r="4" fill="#22d3ee" filter="url(#contrib-glow)"/>
      <text x="43" y="10" class="eyebrow">CONSTELAÇÃO DE CÓDIGO</text>
      <text x="43" y="29" class="small">365 DIAS DE IDEIAS TRANSFORMADAS EM COMMITS</text>
    </g>
    <g transform="translate(778 29)">
      <text x="143" y="22" text-anchor="end" class="total">${xml(compactNumber(total))}</text>
      <text x="143" y="39" text-anchor="end" class="small">CONTRIBUIÇÕES</text>
    </g>
    <line class="beam" x1="39" y1="65" x2="921" y2="65" stroke="url(#contrib-accent)" stroke-width="1"/>
    ${months.join("")}
    <text x="79" y="111" class="day">SEG</text>
    <text x="79" y="137" class="day">QUA</text>
    <text x="79" y="163" class="day">SEX</text>
    ${cells}
    <g transform="translate(39 217)">
      <rect width="174" height="32" rx="10" fill="#ffffff" fill-opacity=".035" stroke="#ffffff" stroke-opacity=".075"/>
      <text x="14" y="14" class="streak-label">SEQUÊNCIA ATUAL</text>
      <text x="160" y="21" text-anchor="end" class="streak-value">${current} dias</text>
    </g>
    <g transform="translate(224 217)">
      <rect width="174" height="32" rx="10" fill="#ffffff" fill-opacity=".035" stroke="#ffffff" stroke-opacity=".075"/>
      <text x="14" y="14" class="streak-label">MELHOR SEQUÊNCIA</text>
      <text x="160" y="21" text-anchor="end" class="streak-value">${longest} dias</text>
    </g>
    <text x="746" y="244" class="small">MENOS</text>
    ${legend}
    <text x="899" y="244" class="small">MAIS</text>
  </svg>`;
}

const [user, repositories, calendar] = await Promise.all([
  request(`https://api.github.com/users/${username}`),
  getRepositories(),
  getContributionCalendar(),
]);
const languages = await getLanguages(repositories);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    new URL("profile-stats.svg", outputDirectory),
    renderStats({ user, languages, calendar }),
  ),
  writeFile(
    new URL("contribution-constellation.svg", outputDirectory),
    renderContributions(calendar),
  ),
]);

console.log("Assets personalizados do perfil gerados com sucesso.");
