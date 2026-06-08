# Zcash Light Wallet Server Sync

A tiny TypeScript project that fetches the latest Zcash light wallet servers from
[hosh.zec.rocks](https://hosh.zec.rocks/zec) and saves them as a JSON list, with the
full server URL plus all the info shown on the uptime table attached to each entry.

The hosh feed mixes **mainnet and testnet** servers in one array with no network
field, so the script classifies each entry and writes two files: `servers.json`
(mainnet) and `servers_testnet.json` (testnet). The Flutter app loads the file
matching the active network. See [Network classification](#network-classification).

## Setup

```bash
npm install
```

## Usage

```bash
npm run sync                       # fetch + write ./servers.json AND ./servers_testnet.json
tsx sync.ts --out=my-servers.json  # custom output path (testnet -> my-servers_testnet.json)
tsx sync.ts --online-only          # only servers currently online
tsx sync.ts --no-tor               # exclude .onion servers
```

Each run writes two files: the `--out` path (mainnet) and a sibling with
`_testnet` inserted before `.json` (testnet). With the default `--out`, that is
`servers.json` and `servers_testnet.json`.

## Network classification

The feed has no network field, so each server is classified as **testnet** when
**any** of the following holds (otherwise it is treated as mainnet):

- its hostname matches `/testnet/i`, or
- it uses a known testnet port (`19067`), or
- its reported block `height` is at/above the testnet height threshold — testnet
  heights cluster ~4.05M while mainnet clusters ~3.37M.

The height threshold is **not hardcoded**: each run fetches the current testnet
tip from the testnet block explorer and rounds it **down to the nearest 100k**
(e.g. tip 4,053,973 → threshold 4,000,000), so it tracks the chain as it grows.
The sync **fails fast** (throws) if the tip can't be fetched or parsed, since the
classification would be unreliable without it. The hostname/port checks backstop
the height heuristic.

Testnet tip source:

```
https://api.testnet.cipherscan.app/api/blocks?limit=1&offset=0
```

Compile/run with plain Node instead of tsx:

```bash
npm run build && npm start
```

## Data source

The script reads the machine-readable JSON API behind the page:

```
https://hosh.zec.rocks/api/v0/zec.json
```

## Ordering

Servers are sorted by three keys, in order:

1. **Online first** — all online servers come before offline ones.
2. **Uptime band** — 10%-wide 30-day uptime bands (`90-100%`, `80-89%`, … `0-9%`), highest band first.
3. **USA ping** — `pingMs` ascending (fastest first).

The flat `servers` array follows this order. The `pingMs` field is the USA ping
reported by the source.

## Output shape

```jsonc
{
  "source": "https://hosh.zec.rocks/api/v0/zec.json",
  "fetchedAt": "2026-06-03T00:00:00.000Z",
  "count": 140,
  // Flat list in final sort order (band desc, online first, USA ping asc).
  "servers": [
    {
      "url": "https://zec.rocks:443",
      "hostname": "zec.rocks",
      "port": 443,
      "protocol": "grpc",
      "online": true,
      "community": false,
      "tor": false,
      "height": 3364423,
      "uptime30d": 0.9872,
      "uptime30dPercent": "98.72%",
      "pingMs": 17.44,
      "lightwalletServerVersion": "v0.4.19",
      "nodeVersion": "Zebra:5.0.0",
      "donationAddress": null
    }
  ]
}
```
