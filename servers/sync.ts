/**
 * sync.ts
 *
 * Fetches the latest Zcash light wallet servers from hosh.zec.rocks and writes a
 * JSON-formatted list to disk. Each entry carries the full server URL plus all the
 * info shown on the uptime table (status, height, uptime, versions, ping, etc.)
 * as a structured object.
 *
 * Usage:
 *   npm run sync                       # fetch + save to ./servers.json
 *   tsx sync.ts --out=my-servers.json  # custom output file
 *   tsx sync.ts --all                  # include offline servers too
 *   tsx sync.ts --no-tor               # drop .onion servers
 *   tsx sync.ts --no-filter-node-version  # keep servers on old node versions
 *
 * By default only servers that are currently online (online === true) are
 * written; pass --all to include offline servers as well.
 *
 * By default servers are also filtered by node version: a server's
 * `nodeVersion` ("Impl:x.y.z") must be >= the minimum configured for its
 * implementation in MIN_NODE_VERSIONS (e.g. Zebra >= 5.0.0,
 * MagicBean >= 6.20.0). Pass --no-filter-node-version to disable this.
 *
 * Servers are sorted online-first, then by 10%-wide 30-day-uptime band
 * (90-100%, 80-89%, ...) highest first, then by ascending USA ping (the
 * `pingMs` field) fastest first. A `groups` view additionally breaks the
 * sorted list out by uptime band, mirroring the hosh.zec.rocks layout.
 *
 * Data source: https://hosh.zec.rocks/api/v0/zec.json
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOURCE_URL = "https://hosh.zec.rocks/api/v0/zec.json";

/**
 * Testnet block-explorer API used to discover the current testnet tip height,
 * which seeds the mainnet/testnet height threshold (see resolveTestnetMinHeight).
 */
const TESTNET_TIP_URL =
  "https://api.testnet.cipherscan.app/api/blocks?limit=1&offset=0";

/**
 * Minimum acceptable node version per node implementation. A server's
 * `nodeVersion` ("Impl:x.y.z") must be >= the minimum for its implementation
 * to pass the version filter. Implementations not listed here are accepted.
 */
const MIN_NODE_VERSIONS: Record<string, string> = {
  Zebra: "5.0.0",
  MagicBean: "6.20.0",
};

/** Well-known testnet light wallet ports. */
const TESTNET_PORTS = new Set<number>([19067]);

/**
 * The hosh feed mixes mainnet and testnet servers in one array with no network
 * field, so they're told apart heuristically. Mainnet heights cluster around
 * ~3.37M while testnet clusters around ~4.05M, so a height threshold in the gap
 * separates the chains.
 *
 * Rather than hardcode that threshold (the gap drifts as both chains grow), we
 * derive it from the current testnet tip and round DOWN to the nearest 100k.
 * e.g. tip 4,053,973 -> 4,000,000. Throws if the tip can't be fetched/parsed,
 * since without it the classification would be unreliable.
 */
async function resolveTestnetMinHeight(): Promise<number> {
  const res = await fetch(TESTNET_TIP_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch testnet tip ${TESTNET_TIP_URL}: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as { blocks?: Array<{ height?: string | number }> };
  const rawHeight = data?.blocks?.[0]?.height;
  // The API reports height as a string (e.g. "4053973"); accept number too.
  const tip = typeof rawHeight === "string" ? Number.parseInt(rawHeight, 10) : rawHeight;
  if (typeof tip !== "number" || !Number.isFinite(tip) || tip <= 0) {
    throw new Error(
      `Unexpected testnet tip response: could not read blocks[0].height from ${TESTNET_TIP_URL}`,
    );
  }
  // Round down to the nearest 100k so the threshold sits just below the tip.
  return Math.floor(tip / 100_000) * 100_000;
}

/**
 * Classify a normalized server as testnet. A server is treated as testnet when
 * its hostname looks like a testnet host, it uses a known testnet port, or its
 * reported block height is at/above [testnetMinHeight]. Everything else is mainnet.
 */
function isTestnet(s: Server, testnetMinHeight: number): boolean {
  if (/testnet/i.test(s.hostname)) return true;
  if (TESTNET_PORTS.has(s.port)) return true;
  if (s.height >= testnetMinHeight) return true;
  return false;
}

/** Raw shape of a server entry as returned by the hosh API. */
interface RawServer {
  hostname: string;
  port: number;
  protocol: string;
  ping: number;
  online: boolean;
  community: boolean;
  height: number;
  uptime_30d: number;
  // Present mostly on online servers:
  lightwallet_server_version?: string;
  node_version?: string;
  donation_address?: string;
}

interface RawResponse {
  servers: RawServer[];
}

/** Normalized server record we persist. */
interface Server {
  /** Full URL, e.g. "https://zec.rocks:443". */
  url: string;
  hostname: string;
  port: number;
  protocol: string;
  online: boolean;
  community: boolean;
  /** true when the hostname is a Tor (.onion) address. */
  tor: boolean;
  height: number;
  /** 30-day uptime as a fraction in [0, 1]. */
  uptime30d: number;
  /** 30-day uptime formatted as a percentage string, e.g. "98.72%". */
  uptime30dPercent: string;
  /** USA ping in milliseconds. */
  pingMs: number;
  lightwalletServerVersion: string | null;
  nodeVersion: string | null;
  donationAddress: string | null;
}

interface Output {
  source: string;
  fetchedAt: string;
  count: number;
  /** Flat list: online first, then uptime band (desc), then USA ping (asc). */
  servers: Server[];
}

interface Options {
  outFile: string;
  onlineOnly: boolean;
  includeTor: boolean;
  filterNodeVersion: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    outFile: "servers.json",
    onlineOnly: true,
    includeTor: true,
    filterNodeVersion: true,
  };
  for (const arg of argv) {
    if (arg.startsWith("--out=")) opts.outFile = arg.slice("--out=".length);
    else if (arg === "--online-only") opts.onlineOnly = true;
    else if (arg === "--all") opts.onlineOnly = false;
    else if (arg === "--no-tor") opts.includeTor = false;
    else if (arg === "--no-filter-node-version") opts.filterNodeVersion = false;
  }
  return opts;
}

/**
 * Parse a "Impl:x.y.z" node version string into its implementation name and a
 * numeric version tuple. Returns null when the string is missing or doesn't
 * carry a parseable "name:version" shape.
 */
function parseNodeVersion(
  nodeVersion: string | null,
): { impl: string; parts: number[] } | null {
  if (!nodeVersion) return null;
  const idx = nodeVersion.indexOf(":");
  if (idx < 0) return null;
  const impl = nodeVersion.slice(0, idx).trim();
  const versionStr = nodeVersion.slice(idx + 1).trim();
  if (!impl || !versionStr) return null;
  // Take the leading dotted-number run (e.g. "6.20.0" out of "6.20.0-rc1").
  const match = versionStr.match(/^\d+(?:\.\d+)*/);
  if (!match) return null;
  const parts = match[0].split(".").map((n) => Number.parseInt(n, 10));
  return { impl, parts };
}

/** Compare two numeric version tuples. Missing trailing parts count as 0. */
function compareVersionParts(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether a server's node version meets the minimum for its implementation.
 * Servers whose version is unparseable are rejected; implementations not listed
 * in MIN_NODE_VERSIONS are accepted as-is.
 */
function meetsMinNodeVersion(s: Server): boolean {
  const parsed = parseNodeVersion(s.nodeVersion);
  if (!parsed) return false;
  const min = MIN_NODE_VERSIONS[parsed.impl];
  if (!min) return true; // no minimum configured for this implementation
  const minParts = min.split(".").map((n) => Number.parseInt(n, 10));
  return compareVersionParts(parsed.parts, minParts) >= 0;
}

/** Build the full URL for a server based on its protocol and port. */
function buildUrl(s: RawServer): string {
  // The hosh API reports protocol "grpc". Light wallet servers speak gRPC,
  // which uses TLS and is reached over https regardless of port.
  // We always expose an https:// URL since that is how these endpoints are reached.
  const scheme = "https";
  // Omit the port when it is the https default (443).
  const isDefaultPort = s.port === 443;
  return isDefaultPort
    ? `${scheme}://${s.hostname}`
    : `${scheme}://${s.hostname}:${s.port}`;
}

function normalize(s: RawServer): Server {
  return {
    url: buildUrl(s),
    hostname: s.hostname,
    port: s.port,
    protocol: s.protocol,
    online: s.online,
    community: s.community,
    tor: s.hostname.toLowerCase().endsWith(".onion"),
    height: s.height,
    uptime30d: s.uptime_30d,
    uptime30dPercent: `${(s.uptime_30d * 100).toFixed(2)}%`,
    pingMs: s.ping,
    lightwalletServerVersion: s.lightwallet_server_version ?? null,
    nodeVersion: s.node_version ?? null,
    donationAddress: s.donation_address ?? null,
  };
}

async function fetchServers(): Promise<RawServer[]> {
  const res = await fetch(SOURCE_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${SOURCE_URL}: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as RawResponse;
  if (!data || !Array.isArray(data.servers)) {
    throw new Error("Unexpected response shape: missing `servers` array.");
  }
  return data.servers;
}

/** The 10%-wide uptime band a server falls into, as a lower-bound percent (0,10,...,100). */
function uptimeBucketOf(s: Server): number {
  const pct = s.uptime30d * 100;
  // 100% rounds down to the 90 band so it sits with the other top performers,
  // matching how the hosh page lumps the highest uptimes together.
  return Math.min(90, Math.floor(pct / 10) * 10);
}

/** USA-ping comparator: fastest first. Offline servers (ping 0) sink to the bottom. */
function byUsaPing(a: Server, b: Server): number {
  // Treat a 0ms ping (offline / unmeasured) as worst so it never ranks first.
  const pa = a.pingMs > 0 ? a.pingMs : Number.POSITIVE_INFINITY;
  const pb = b.pingMs > 0 ? b.pingMs : Number.POSITIVE_INFINITY;
  return pa - pb;
}

/**
 * Canonical sort order: online servers first, then by uptime band (highest
 * first), then by ascending USA ping (fastest first).
 */
function compareServers(a: Server, b: Server): number {
  if (a.online !== b.online) return a.online ? -1 : 1; // online before offline
  const bucketDiff = uptimeBucketOf(b) - uptimeBucketOf(a); // higher band first
  if (bucketDiff !== 0) return bucketDiff;
  return byUsaPing(a, b); // then fastest USA ping first
}

/** Derive the testnet output path from the mainnet one ("x.json" -> "x_testnet.json"). */
function testnetOutFile(mainnetOutFile: string): string {
  return mainnetOutFile.replace(/\.json$/i, "_testnet.json");
}

/**
 * Sort a server list into canonical order and write the standard Output shape
 * to `outFile`. Logs a summary. Returns nothing.
 */
async function writeServerFile(
  servers: Server[],
  outFile: string,
  fetchedAt: string,
): Promise<void> {
  // Sort: online first, then uptime band (highest first), then USA ping (fastest first).
  const sorted = [...servers].sort(compareServers);

  const output: Output = {
    source: SOURCE_URL,
    fetchedAt,
    count: sorted.length,
    servers: sorted,
  };

  const outPath = resolve(process.cwd(), outFile);
  await writeFile(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  const onlineCount = sorted.filter((s) => s.online).length;
  console.log(`Saved ${sorted.length} servers (${onlineCount} online) -> ${outPath}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // Derive the mainnet/testnet height threshold from the live testnet tip.
  // Throws if unreachable — without it the chain classification is unreliable.
  console.log(`Fetching testnet tip from ${TESTNET_TIP_URL} ...`);
  const testnetMinHeight = await resolveTestnetMinHeight();
  console.log(`Testnet height threshold: >= ${testnetMinHeight.toLocaleString("en-US")}`);

  console.log(`Fetching Zcash light wallet servers from ${SOURCE_URL} ...`);
  const raw = await fetchServers();

  let servers = raw.map(normalize);
  // Keep only online servers (online === true) by default; pass --all to disable.
  if (opts.onlineOnly) servers = servers.filter((s) => s.online === true);
  if (!opts.includeTor) servers = servers.filter((s) => !s.tor);
  // Keep only servers whose node version meets the per-implementation minimum
  // (default on); pass --no-filter-node-version to disable.
  if (opts.filterNodeVersion) servers = servers.filter(meetsMinNodeVersion);

  // The hosh feed mixes both chains; split them into separate files so the app
  // can offer network-appropriate servers (see isTestnet for the heuristic).
  const testnetServers = servers.filter((s) => isTestnet(s, testnetMinHeight));
  const mainnetServers = servers.filter((s) => !isTestnet(s, testnetMinHeight));

  // Single timestamp shared by both files so they reflect one fetch.
  const fetchedAt = new Date().toISOString();

  console.log(`\nMainnet servers -> ${opts.outFile}`);
  await writeServerFile(mainnetServers, opts.outFile, fetchedAt);

  const testnetOut = testnetOutFile(opts.outFile);
  console.log(`\nTestnet servers -> ${testnetOut}`);
  await writeServerFile(testnetServers, testnetOut, fetchedAt);
}

main().catch((err) => {
  console.error("sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
