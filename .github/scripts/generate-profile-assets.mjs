import { mkdir, readFile, writeFile } from "node:fs/promises";

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

async function getCachedProfileData() {
  const svg = await readFile(new URL("profile-stats.svg", outputDirectory), "utf8");
  const repositoryMatch = svg.match(
    /class="metric">([^<]+)<\/text>\s*<text[^>]*class="label">Repositórios públicos/i,
  );
  const languages = [...svg.matchAll(
    /<circle[^>]*fill="([^"]+)"\/>\s*<text[^>]*class="language">([^<]+)<\/text>\s*<text[^>]*class="percentage">([\d,.]+)%<\/text>/g,
  )].map((match) => ({
    color: match[1],
    name: match[2],
    percentage: Number(match[3].replace(",", ".")),
  }));

  if (!repositoryMatch || !languages.length) {
    throw new Error("Nao foi possivel aproveitar os dados locais anteriores.");
  }
  return {
    user: { public_repos: Number(repositoryMatch[1]) },
    languages,
  };
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

function renderStats({ user, languages, calendar }) {
  const { current } = calculateStreaks(calendar.days);
  const metrics = [
    ["Contribuições · 12 meses", calendar.total],
    ["Sequência atual", `${current} dias`],
    ["Repositórios públicos", user.public_repos],
  ];

  const metricColumns = metrics
    .map(([label, value], index) => {
      const x = 55 + index * 295;
      const divider = index
        ? '<line x1="-35" y1="0" x2="-35" y2="54" stroke="#30363d"/>'
        : "";
      return `
        <g transform="translate(${x} 74)">${divider}
          <text y="27" class="metric">${xml(compactNumber(value))}</text>
          <text y="48" class="label">${label}</text>
        </g>`;
    })
    .join("");

  let segmentX = 28;
  const barWidth = 844;
  const languageSegments = languages
    .map((language, index) => {
      const width =
        index === languages.length - 1
          ? 28 + barWidth - segmentX
          : Math.max((language.percentage / 100) * barWidth, 4);
      const segment = `<rect x="${segmentX.toFixed(1)}" y="169" width="${width.toFixed(1)}" height="7" fill="${language.color}"/>`;
      segmentX += width + 1;
      return segment;
    })
    .join("");

  const languageLabels = languages
    .map((language, index) => {
      const x = 28 + index * (844 / Math.max(languages.length, 1));
      return `
        <g transform="translate(${x.toFixed(1)} 202)">
          <circle cx="4" cy="-3" r="3.5" fill="${language.color}"/>
          <text x="14" class="language">${xml(language.name)}</text>
          <text x="14" y="15" class="percentage">${language.percentage.toFixed(1).replace(".", ",")}%</text>
        </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="230" viewBox="0 0 900 230" role="img" aria-labelledby="title description">
    <title id="title">Painel GitHub de Abraão Paixão</title>
    <desc id="description">Resumo de contribuições, sequência atual, repositórios e linguagens mais utilizadas.</desc>
    <style>
      text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .heading{fill:#f0f6fc;font-size:16px;font-weight:600}
      .username{fill:#8b949e;font-size:12px}
      .metric{fill:#a78bfa;font-size:25px;font-weight:650}
      .label{fill:#8b949e;font-size:10px}
      .section{fill:#c9d1d9;font-size:12px;font-weight:600}
      .language{fill:#c9d1d9;font-size:10px}
      .percentage{fill:#6e7681;font-size:9px}
    </style>
    <rect x=".5" y=".5" width="899" height="229" rx="8" fill="#0d1117" stroke="#30363d"/>
    <text x="28" y="35" class="heading">Abraão no GitHub</text>
    <text x="872" y="35" text-anchor="end" class="username">@${username}</text>
    <line x1="28" y1="52" x2="872" y2="52" stroke="#21262d"/>
    ${metricColumns}
    <text x="28" y="151" class="section">Linguagens mais usadas</text>
    <rect x="28" y="169" width="844" height="7" fill="#21262d"/>
    ${languageSegments}
    ${languageLabels}
  </svg>`;
}

function renderContributions({ days, total }) {
  const { current, longest } = calculateStreaks(days);
  const cellColors = ["#21262d", "#2e1065", "#4c1d95", "#7c3aed", "#c4b5fd"];
  const start = new Date(`${days[0].date}T00:00:00Z`);
  const heatmapX = 82;
  const heatmapY = 82;
  const step = 14;

  const cells = days
    .map((day) => {
      const date = new Date(`${day.date}T00:00:00Z`);
      const difference = Math.round((date - start) / 86_400_000);
      const week = Math.floor(difference / 7);
      const weekday = date.getUTCDay();
      const x = heatmapX + week * step;
      const y = heatmapY + weekday * step;
      return `<rect x="${x}" y="${y}" width="11" height="11" rx="2.5" fill="${cellColors[day.level]}" data-date="${day.date}"/>`;
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
      if (x < 835) months.push(`<text x="${x}" y="70" class="month">${monthNames[date.getUTCMonth()]}</text>`);
      shownMonths.add(key);
    }
  }

  const legend = cellColors
    .map((color, index) => `<rect x="${775 + index * 14}" y="213" width="9" height="9" rx="2" fill="${color}"/>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="238" viewBox="0 0 900 238" role="img" aria-labelledby="title description">
    <title id="title">Contribuições de Abraão Paixão</title>
    <desc id="description">Mapa das contribuições realizadas nos últimos 365 dias.</desc>
    <style>
      text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .heading{fill:#f0f6fc;font-size:16px;font-weight:600}
      .summary{fill:#8b949e;font-size:11px}
      .month,.day{fill:#6e7681;font-size:8px}
      .footer{fill:#8b949e;font-size:10px}
      .legend{fill:#6e7681;font-size:9px}
    </style>
    <rect x=".5" y=".5" width="899" height="237" rx="8" fill="#0d1117" stroke="#30363d"/>
    <text x="28" y="34" class="heading">Contribuições</text>
    <text x="872" y="34" text-anchor="end" class="summary"><tspan fill="#a78bfa" font-weight="600">${xml(compactNumber(total))}</tspan> no último ano</text>
    <line x1="28" y1="49" x2="872" y2="49" stroke="#21262d"/>
    ${months.join("")}
    <text x="50" y="103" class="day">SEG</text>
    <text x="50" y="131" class="day">QUA</text>
    <text x="50" y="159" class="day">SEX</text>
    ${cells}
    <line x1="28" y1="196" x2="872" y2="196" stroke="#21262d"/>
    <text x="28" y="221" class="footer">Sequência atual: ${current} dias  ·  Maior sequência: ${longest} dias</text>
    <text x="735" y="221" class="legend">menos</text>
    ${legend}
    <text x="871" y="221" text-anchor="end" class="legend">mais</text>
  </svg>`;
}

await mkdir(outputDirectory, { recursive: true });
const calendar = await getContributionCalendar();
const [userResult, repositoriesResult] = await Promise.allSettled([
  request(`https://api.github.com/users/${username}`),
  getRepositories(),
]);

let user;
let languages;
if (userResult.status === "fulfilled" && repositoriesResult.status === "fulfilled") {
  user = userResult.value;
  languages = await getLanguages(repositoriesResult.value);
} else {
  console.warn("API limitada; usando as estatisticas locais mais recentes.");
  ({ user, languages } = await getCachedProfileData());
}

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
