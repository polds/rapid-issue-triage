// Dependency license gate for the frontend tree.
//
// Two policies, because two audiences:
//
//   * `.prod` packages are bundled into web/dist, which `go:embed` compiles
//     into the released binary. Anything we redistribute has to be on an
//     explicit allow-list ($WEB_LICENSE_ALLOW).
//   * everything else is dev tooling that never leaves the machine, so it
//     only has to clear a deny-list of copyleft / source-available licenses
//     ($WEB_LICENSE_DENY) that would still be awkward to depend on.
//
// The tree comes from `npm query`, npm's own dependency-tree selector, so this
// pulls in no third-party scanner of its own -- a license auditor added to
// inspect the supply chain is more supply chain.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportOnly = process.argv.includes("--report");

const list = (name) =>
  (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const allow = new Set(list("ALLOW"));
const deny = new Set(list("DENY").map((s) => s.toUpperCase()));

if (allow.size === 0 || deny.size === 0) {
  console.error("ALLOW and DENY must be set (the Makefile passes them)");
  process.exit(2);
}

function query(selector) {
  const out = execFileSync("npm", ["query", selector, "--json"], {
    cwd: webRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

// `.location === ""` is the workspace root itself: private, unpublished, and
// not a dependency of anything.
const isDep = (n) => n.location !== "" && n.name;

const prod = new Map(query(".prod").filter(isDep).map((n) => [`${n.name}@${n.version}`, n]));
const all = new Map(query("*").filter(isDep).map((n) => [`${n.name}@${n.version}`, n]));

// npm records either a plain SPDX id or, for dual-licensed packages, an SPDX
// expression. Split on the boolean operators and treat the package as clearing
// the bar when any one of its options does -- that is what a chooser gets.
function options(node) {
  const raw = node.license;
  if (typeof raw === "string") return raw.replace(/[()]/g, " ").split(/\s+(?:OR|AND)\s+/i).map((s) => s.trim()).filter(Boolean);
  // Some very old packages publish `license: {type: "MIT"}` or an array.
  if (Array.isArray(raw)) return raw.map((l) => (typeof l === "string" ? l : (l?.type ?? ""))).filter(Boolean);
  if (raw && typeof raw === "object" && raw.type) return [raw.type];
  return [];
}

if (reportOnly) {
  const rows = [...all.entries()]
    .map(([id, n]) => [id, options(n).join(" OR ") || "UNKNOWN", prod.has(id) ? "prod" : "dev"])
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (const [id, lic, scope] of rows) console.log(`${id},${lic},${scope}`);
  process.exit(0);
}

const problems = [];

for (const [id, node] of prod) {
  const opts = options(node);
  if (opts.length === 0) {
    problems.push(`${id}: no license declared, and it ships inside web/dist`);
  } else if (!opts.some((l) => allow.has(l))) {
    problems.push(`${id}: ${opts.join(" OR ")} is not on the redistribution allow-list`);
  }
}

for (const [id, node] of all) {
  if (prod.has(id)) continue; // already held to the stricter bar above
  const opts = options(node);
  if (opts.length > 0 && opts.every((l) => deny.has(l.toUpperCase()))) {
    problems.push(`${id}: ${opts.join(" OR ")} is on the dev-dependency deny-list`);
  }
}

if (problems.length > 0) {
  console.error(`web dependency licenses: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nFix by dropping the dependency, or -- if the license really is");
  console.error("acceptable -- widen WEB_LICENSE_ALLOW / narrow WEB_LICENSE_DENY in the");
  console.error("Makefile in the same commit, with a comment saying why.");
  process.exit(1);
}

console.log(`web dependency licenses: ${prod.size} bundled, ${all.size - prod.size} dev-only, all clear`);
