// Generates assets/ado-stats.svg in the github-readme-stats github_dark style.
// Env: ADO_ORG_URL, ADO_PROJECTS (comma-separated, optional), ADO_AUTHOR_EMAIL, ADO_PAT

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const {
  ADO_ORG_URL,
  ADO_PROJECTS = "",
  ADO_AUTHOR_EMAIL,
  ADO_PAT,
} = process.env;

if (!ADO_ORG_URL || !ADO_AUTHOR_EMAIL || !ADO_PAT) {
  console.error("Missing ADO_ORG_URL, ADO_AUTHOR_EMAIL, or ADO_PAT");
  process.exit(1);
}

const orgUrl = ADO_ORG_URL.replace(/\/$/, "");
const auth = "Basic " + Buffer.from(":" + ADO_PAT).toString("base64");
const headers = { Authorization: auth, Accept: "application/json" };

async function api(path) {
  const res = await fetch(`${orgUrl}${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${path}`);
  return res.json();
}

async function postApi(path, body) {
  const res = await fetch(`${orgUrl}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${path}`);
  return res.json();
}

async function listProjects() {
  if (ADO_PROJECTS) return ADO_PROJECTS.split(",").map((p) => p.trim()).filter(Boolean);
  const data = await api(`/_apis/projects?api-version=7.1&$top=200`);
  return data.value.map((p) => p.name);
}

async function listRepos(project) {
  const data = await api(`/${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1`);
  return data.value;
}

async function countCommits(project, repoId) {
  // searchCriteria.author filters by author display name OR email
  const path =
    `/${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/commits` +
    `?searchCriteria.author=${encodeURIComponent(ADO_AUTHOR_EMAIL)}` +
    `&searchCriteria.$top=1&api-version=7.1`;
  // Use $top=1 with includeStatuses=false; ADO doesn't return total count, so page through with skip.
  let total = 0;
  const pageSize = 1000;
  let skip = 0;
  while (true) {
    const data = await api(
      `/${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/commits` +
        `?searchCriteria.author=${encodeURIComponent(ADO_AUTHOR_EMAIL)}` +
        `&searchCriteria.$top=${pageSize}&searchCriteria.$skip=${skip}&api-version=7.1`
    );
    const n = data.value?.length ?? 0;
    total += n;
    if (n < pageSize) break;
    skip += pageSize;
  }
  return total;
}

async function countPRs(project, status) {
  // status: "completed" | "active" | "abandoned" | "all"
  let total = 0;
  const pageSize = 1000;
  let skip = 0;
  while (true) {
    const data = await api(
      `/${encodeURIComponent(project)}/_apis/git/pullrequests` +
        `?searchCriteria.creatorId=&searchCriteria.status=${status}` +
        `&$top=${pageSize}&$skip=${skip}&api-version=7.1`
    );
    // creatorId requires a GUID; we filter client-side by email match on createdBy.uniqueName
    const mine = (data.value ?? []).filter(
      (pr) => pr.createdBy?.uniqueName?.toLowerCase() === ADO_AUTHOR_EMAIL.toLowerCase()
    );
    total += mine.length;
    if ((data.value?.length ?? 0) < pageSize) break;
    skip += pageSize;
  }
  return total;
}

async function countWorkItems(project) {
  const wiql = {
    query:
      `SELECT [System.Id] FROM WorkItems ` +
      `WHERE [System.TeamProject] = '${project.replace(/'/g, "''")}' ` +
      `AND [System.CreatedBy] = '${ADO_AUTHOR_EMAIL}'`,
  };
  try {
    const data = await postApi(
      `/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`,
      wiql
    );
    return data.workItems?.length ?? 0;
  } catch {
    return 0;
  }
}

async function gather() {
  const projects = await listProjects();
  let commits = 0;
  let prs = 0;
  let workItems = 0;
  const contributedRepos = new Set();

  for (const project of projects) {
    const repos = await listRepos(project).catch(() => []);
    for (const repo of repos) {
      const c = await countCommits(project, repo.id).catch(() => 0);
      if (c > 0) {
        commits += c;
        contributedRepos.add(`${project}/${repo.name}`);
      }
    }
    prs += await countPRs(project, "all").catch(() => 0);
    workItems += await countWorkItems(project).catch(() => 0);
  }

  return {
    commits,
    prs,
    workItems,
    contributed: contributedRepos.size,
  };
}

// SVG mimics github-readme-stats github_dark theme:
//   bg #151b23, title #e7edf4, icon #58a6ff, text #f0f6fc
function renderSvg({ commits, prs, workItems, contributed }) {
  const rows = [
    { icon: "commit", label: "Total Commits", value: commits },
    { icon: "pr", label: "Total PRs", value: prs },
    { icon: "issue", label: "Total Work Items", value: workItems },
    { icon: "repo", label: "Contributed to", value: contributed },
  ];

  const icons = {
    commit:
      `<path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" fill="#58a6ff"/>`,
    pr:
      `<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" fill="#58a6ff"/>`,
    issue:
      `<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="#58a6ff"/><path fill-rule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z" fill="#58a6ff"/>`,
    repo:
      `<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.694 1.72.75.75 0 0 1-1.04 1.08A2.5 2.5 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.493 2.493 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" fill="#58a6ff"/>`,
  };

  const rowHeight = 30;
  const startY = 65;
  const items = rows
    .map((r, i) => {
      const y = startY + i * rowHeight;
      return `
  <g transform="translate(25, ${y})">
    <svg x="0" y="-13" viewBox="0 0 16 16" width="16" height="16">${icons[r.icon]}</svg>
    <text x="25" y="0" class="stat bold">${r.label}:</text>
    <text x="220" y="0" class="stat bold" text-anchor="end">${r.value.toLocaleString()}</text>
  </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="195" viewBox="0 0 450 195" fill="none" font-family="'Segoe UI', Ubuntu, Sans-Serif">
  <style>
    .header { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: #58a6ff; }
    .stat { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
    .bold { font-weight: 700; }
  </style>
  <text x="25" y="35" class="header">Tim's Azure DevOps Stats</text>
  ${items}
</svg>
`;
}

const stats = await gather();
console.log("ADO stats:", stats);
const svg = renderSvg(stats);
const out = resolve("assets/ado-stats.svg");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, svg, "utf8");
console.log("Wrote", out);
