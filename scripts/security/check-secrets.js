#!/usr/bin/env node
/**
 * Pre-commit secret guard. Scans the lines being ADDED in the staged diff (and the names of staged
 * files) for credentials. Blocks the commit on a match.
 *
 *   node scripts/security/check-secrets.js            # scan the staged diff
 *   node scripts/security/check-secrets.js --self-test
 *
 * Enable for this clone:  git config core.hooksPath .githooks
 * Bypass only for a verified false positive:  git commit --no-verify
 */
const { execFileSync } = require("child_process");

const PATTERNS = [
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["SendGrid API key", /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/],
  ["URI with embedded credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:[^\s@'"]{3,}@[^\s'"]+/i],
  ["Telegram bot token", /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["OpenAI/Anthropic-style secret key", /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  [
    "64-hex value assigned to a key/secret variable",
    /(?:private[_-]?key|secret|mnemonic|seed)\w*\s*[:=]\s*['"]?(?:0x)?[0-9a-fA-F]{64}\b/i,
  ],
  [
    "secret-looking assignment",
    /\b(?:[A-Z0-9_]*(?:PASSWORD|SECRET|PRIVATE_KEY|API_KEY|AUTH_TOKEN)[A-Z0-9_]*)\s*=\s*['"]?(?!YOUR_|your_|<|\$|\{|0xYOUR|changeme|example|xxx|None|null|undefined|process\.env)[A-Za-z0-9/+_.=-]{16,}['"]?\s*$/,
  ],
];

const FORBIDDEN_FILES = [
  /(^|\/)\.env(\.[^/]*)?$/, // .env, .env.local, .env.telegram ...
  /(^|\/)[^/]+\.env$/, // extensions/firestore-send-email.env
  /(^|\/)keystore[^/]*$/i,
  /\.(pem|p12|pfx|jks)$/i,
  /(^|\/)serviceAccount[^/]*\.json$/i,
];
const ALLOWED_FILES = [/\.example$/, /\.sample$/, /\.template$/];

function scanLine(line) {
  const hits = [];
  for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(name);
  return hits;
}

function forbiddenFile(name) {
  return FORBIDDEN_FILES.some((re) => re.test(name)) && !ALLOWED_FILES.some((re) => re.test(name));
}

function selfTest() {
  const must = [
    "SMTP_CONNECTION_URI=smtps://apikey:SG.abcdefghijklmnop.qrstuvwxyz012345@smtp.sendgrid.net:465",
    "const key = 'SG.abcdefghijklmnop.qrstuvwxyz0123456789';",
    "-----BEGIN PRIVATE KEY-----",
    'PRIVATE_KEY = "0x' + "a1".repeat(32) + '"',
    "DEPLOYER_PRIVATE_KEY=0x" + "b2".repeat(32),
    "TELEGRAM_TOKEN=1234567890:AAH" + "x".repeat(32),
    "SOME_API_KEY=abcdef0123456789abcdef0123",
  ];
  const mustNot = [
    "DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE",
    "ETHERSCAN_API_KEY=YOUR_ETHERSCAN_KEY_HERE",
    "const rpc = process.env.RPC_URL;",
    "const tx = '0x" + "c3".repeat(32) + "';", // a transaction hash is not a secret
    "https://sepolia.base.org",
    "SMTP_PASSWORD=",
  ];
  let ok = true;
  for (const l of must)
    if (!scanLine(l).length) {
      ok = false;
      console.error("MISSED:", l.slice(0, 60));
    }
  for (const l of mustNot)
    if (scanLine(l).length) {
      ok = false;
      console.error("FALSE POSITIVE:", l.slice(0, 60));
    }
  for (const f of [
    ".env",
    "extensions/firestore-send-email.env",
    "x/serviceAccountKey.json",
    "a/b.pem",
  ])
    if (!forbiddenFile(f)) {
      ok = false;
      console.error("FILE MISSED:", f);
    }
  for (const f of [".env.example", "extensions/firestore-send-email.env.example"])
    if (forbiddenFile(f)) {
      ok = false;
      console.error("FILE FALSE POSITIVE:", f);
    }
  console.log(ok ? "self-test OK" : "self-test FAILED");
  process.exit(ok ? 0 : 1);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const git = (args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const problems = [];

  for (const f of git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    .split("\n")
    .filter(Boolean))
    if (forbiddenFile(f))
      problems.push(`${f}: file type must never be committed (use a .example template)`);

  let file = "";
  let lineNo = 0;
  for (const raw of git(["diff", "--cached", "-U0", "--no-color", "--diff-filter=ACMR"]).split(
    "\n",
  )) {
    if (raw.startsWith("+++ b/")) file = raw.slice(6);
    else if (raw.startsWith("@@")) lineNo = Number((/\+(\d+)/.exec(raw) || [0, 0])[1]) - 1;
    else if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lineNo++;
      if (file.endsWith("scripts/security/check-secrets.js")) continue; // contains the test samples
      for (const name of scanLine(raw.slice(1))) problems.push(`${file}:${lineNo}: ${name}`);
    }
  }

  if (problems.length) {
    console.error("\nCommit blocked: possible secrets in the staged changes:\n");
    for (const p of problems) console.error("  - " + p);
    console.error("\nRemove them (use environment variables / untracked .env files).");
    console.error("If this is a verified false positive: git commit --no-verify\n");
    process.exit(1);
  }
}

main();
