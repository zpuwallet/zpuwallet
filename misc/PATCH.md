# PATCH

List of patches for custom zkool wallet

## Table of Contents

- [Build / regen notes](#build--regen-notes)
- **Wallet New**
  - [Multi-network support (testnet / regtest)](#multi-network-support-testnet--regtest)
  - [Portable build: ship `zkool_portable.exe`](#portable-build-ship-zkool_portableexe)
- **Wallet Fix**
  - [Transparent-address scan default gap limit](#transparent-address-scan-default-gap-limit)
  - [Portable build: settings stored under `./db`](#portable-build-settings-stored-under-db)
- **UI New**
  - [Receive Funds: derivation paths](#receive-funds-derivation-paths)
  - [Confirmation count in Transaction History](#confirmation-count-in-transaction-history)
  - [Switch Network page + Account List button + Account menu item](#switch-network-page--account-list-button--account-menu-item)
- **UI Fix**
  - [Account list: long-press to select](#account-list-long-press-to-select)
  - [Transaction TXID popup returns to account page](#transaction-txid-popup-returns-to-account-page)
  - [Account import navigates to the account list](#account-import-navigates-to-the-account-list)
  - [Live per-account sync progress](#live-per-account-sync-progress)
  - [Account list height not flagged stale on regtest](#account-list-height-not-flagged-stale-on-regtest)
- **Settings New**
  - [Block Explorer dropdown](#block-explorer-dropdown)
  - [Network-aware explorers](#network-aware-explorers)
  - [Changed defaults: FX auto-fetch + auto-sync interval](#changed-defaults-fx-auto-fetch--auto-sync-interval)

## Build / regen notes

- Rust + FRB changes require `RUSTFLAGS='--cfg zcash_unstable="nu7"'` and an FRB
  regen (`flutter_rust_bridge_codegen generate`) on a working build environment;
  generated files (`frb_generated.*`, `*.g.dart`, `*.freezed.dart`) are not
  hand-edited. On Windows, use `misc/codegen.ps1` (native MSVC + vcpkg OpenSSL),
  followed by `flutter pub get` + `dart run build_runner build
  --delete-conflicting-outputs` to regenerate `*.freezed.dart` / `*.g.dart`.
- Build/verify with `flutter pub get` + `flutter analyze`, then `flutter build
  windows` / `cargo check --features flutter`. The build scripts (`misc/*.ps1`)
  and upstream CI pin **Flutter 3.44.2**; FRB is pinned at **2.12.0**.
- Items marked **(Dart-only)** need no codegen/RUSTFLAGS rebuild.

> **Rebase note (6.18.1 → 6.20.0-rc.8):** upstream removed the
> showcaseview/tutorial system entirely and refactored `receive.dart`,
> `showTxHistory`, and `TransactionTile` (which now renders a `contactName`).
> The following original patches were therefore **dropped** during the rebase:
> *"Previous Set of Addresses"* (Receive Funds) and its Rust
> `generate_prev_dindex` backing, the *"Mnemonic import wrong receive-address
> index"* Rust fix (upstream `default_address` behavior kept), and *"Tutorials
> skipped by default"* (moot — no tutorials upstream). The *Confirmation count*
> patch was reworked to coexist with upstream's `contactName`.

---

# Wallet New

## Multi-network support (testnet / regtest)

Run **mainnet**, **testnet**, and **regtest** side by side, each with its **own
accounts** (nothing shared between networks). Switching happens **live, without
an app restart**. Per-network isolation uses **one SQLite database file per
network**.

| Network | DB name (base `zkool`) | coin | default server | light node |
|---------|------------------------|------|----------------|------------|
| Zcash (mainnet) | `zkool`          | 0 | `https://zec.rocks`          | yes |
| Zcash Testnet   | `zkool-testnet`  | 1 | `https://testnet.zec.rocks`  | yes |
| Zcash Regtest   | `zkool-regtest`  | 2 | `http://127.0.0.1:18232` (Zebra) | **no** |

- **Rust — explicit coin on `open_database` (`rust/src/api/coin.rs`, +FRB regen,
  + `graphql-cli.rs` caller):** `Coin::open_database` gains a third argument
  `coin: Option<u8>`. `Some(c)` is authoritative (persisted to the DB `coin`
  prop and used as the network); `None` falls back to the stored prop (default
  mainnet `0`). `migrate_sapling_addresses` now uses the **resolved** coin (the
  upstream `backfill_diversifier_index` call is preserved). `try_open` no longer
  overwrites the `coin` prop on every open — it seeds from the filename **only
  when missing**, so an explicit choice is never clobbered.
- **`lib/network.dart` (new):** single source of truth —
  `enum ZNetwork { mainnet, testnet, regtest }` with a `NetworkInfo` per network
  (coin id, label, db suffix, default LWD + alternatives, default explorer,
  light-node default) plus the `kNetworks` map, the `networkInfo` accessor and
  helpers `networkForCoin`, `networkForName`, `baseDbName`, `dbNameForNetwork`,
  `networkTitle`, `networkSuffix`, `networkAccent`, the `kNetworkIconAsset`
  constant, and a `ZNetworkX` extension. Each `NetworkInfo` carries a
  `dbSuffix`: mainnet uses
  an empty suffix (`""`) so its DB keeps the base name `zkool` and existing
  installs are untouched; testnet/regtest use `-testnet` / `-regtest`.
  Regtest defaults to a Zebra full node (`defaultIsLightNode: false`).
- **Live network switch (`lib/store.dart`):**
  - `SynchronizerNotifier.stop()` tears down the in-flight sync (`cancelSync`,
    cancels the progress subscription, resets retry/in-progress state, `end()`)
    so no stream keeps writing to the previous network's DB pool. (Adapted to
    upstream's synchronizer, which dropped the `retrySyncTimer` field in favor
    of an in-loop backoff.)
  - `openAndWireDatabase(...)` — shared open-flow (password-retry loop, seed
    per-network defaults, set LWD/Tor/proxy, publish to `coinContext`), reused by
    both startup and switching.
  - `_seedNetworkDefaults(...)` — on first open of a network DB, seeds `lwd`,
    `is_light_node`, and `block_explorer` props from `NetworkInfo` when absent.
  - `switchNetwork(ref, net, askPassword:)` — stop sync + mempool → reset
    selected account → open the per-network DB → persist `database` + `network`
    prefs → invalidate all network-scoped providers (incl. a fresh
    `currentHeightProvider` fetch) → restart auto-sync and the mempool listener.
- **Startup & new-DB callers:** `splash.dart` reads the persisted `network` pref
  and passes it as the explicit `coin` to `openDatabase`, restoring the
  last-used network on launch (falls back to `null` → stored prop for existing
  single-network installs). `db.dart` opens the Database Manager's "new
  database" with the currently-active network's coin.

> See also **UI New → Switch Network page** and **Settings New → Network-aware
> explorers**.

## Portable build: ship `zkool_portable.exe`

**Files:** `windows/CMakeLists.txt`, `lib/utils.dart`, `lib/main.dart`,
`lib/pages/db.dart`, `lib/vault.dart`

- **`windows/CMakeLists.txt`:** after `install(TARGETS …)`, an `install(CODE …)`
  step runs `${CMAKE_COMMAND} -E copy_if_different` to copy `zkool.exe` →
  `zkool_portable.exe`, so `flutter build windows` produces both binaries side by
  side.
- **`utils.dart`:** added `isPortable` (true when the running executable is named
  `zkool_portable…`), `getDataDirectory()` and a `joinPath()` helper. The
  portable build stores its data in a local `./db` directory next to the
  executable; the normal build keeps using the OS application-documents
  directory.
- **`main.dart`, `db.dart`, `vault.dart`:** switched from
  `getApplicationDocumentsDirectory()` to `getDataDirectory()` so the data dir,
  the DB-manager listing and the vault key files all honor portable mode.
- **`utils.dart` — `getFullDatabasePath()`:** the central DB-path helper (used by
  splash, the DB manager, and network switching) was likewise rewired from
  `getApplicationDocumentsDirectory()` + `'${dbDir.path}/$dbName.db'` to
  `getDataDirectory()` + `joinPath(dbDir.path, '$dbName.db')`, so the SQLite DB
  file path honors portable mode (`./db` next to the executable) and uses
  `joinPath` for platform-correct separators.

---

# Wallet Fix

## Transparent-address scan default gap limit

**(Dart-only)**

- `lib/store.dart` — `TransparentScan.gapLimit` default changed from **40** to
  **20**.

## Portable build: settings stored under `./db`

**(Dart-only)**

**Files:** `lib/prefs.dart` (new), `lib/main.dart`, `lib/store.dart`,
`lib/settings.dart`, `lib/utils.dart`, `lib/pages/db.dart`,
`lib/pages/splash.dart`, `lib/pages/disclaimer.dart`, `lib/pages/lwd_select.dart`

- **Problem:** the portable build keeps its SQLite DBs and vault files in the
  local `./db` directory, but `SharedPreferencesAsync` persists settings to a
  per-user OS-native store — **not** a relocatable file — so a portable copy lost
  its theme, selected database, FX/Tor settings, etc. when moved.
- **`lib/prefs.dart` (new):** `AppPrefs`, a drop-in wrapper mirroring the exact
  `SharedPreferencesAsync` method surface the app uses (`getString`/`getBool`/
  `getInt`, `setString`/`setBool`/`setInt`, `remove`, plus `init()`). It selects a
  backend from the `isPortable` getter:
  - **Portable** → a JSON file at `./db/settings.json` (via `getDataDirectory()` +
    `joinPath()`), with an in-memory cache and a temp-file-then-rename write so a
    crash mid-write can't leave a half-written file. A missing/corrupt file falls
    back to defaults instead of crashing.
  - **Non-portable** → delegates straight to a real `SharedPreferencesAsync()`, so
    behavior is **identical to before**.
- **`main.dart`:** calls `await AppPrefs().init()` right after `initDatadir(...)`.
- **Call-site swap:** every `final prefs = SharedPreferencesAsync();` across
  `store.dart`, `settings.dart`, `main.dart`, `db.dart`, `disclaimer.dart`,
  `lwd_select.dart` became `final prefs = AppPrefs();`; the per-file
  `shared_preferences` import was replaced with `package:zkool/prefs.dart`.
- **No migration:** first portable run starts with fresh defaults.

---

# UI New

## Receive Funds: derivation paths

**File:** `lib/pages/receive.dart`

- A small, monospace, hint-colored line under each address showing how it was
  derived, computed in Dart from `account.aindex`,
  `addresses.diversifierIndex`, and the network name.
  - Coin type from `getNetworkName` (a Rust binding): mainnet → `133'`,
    test/regtest → `1'`.
  - **Transparent** path: `m/44'/{coinType}'/{aindex}'/0/{diversifierIndex}`.
  - **Shielded** (Sapling / Orchard / Unified): `m/32'/{coinType}'/{aindex}'`,
    diversifier index shown separately.
  - Wired into all four address tiles (Unified, Orchard-only, Sapling,
    Transparent). New helpers: `getNetworkName` usage, `coinType`,
    `transparentPath()`, `shieldedPath()`, `derivationLabel()`,
    `derivationInfo()`.

## Confirmation count in Transaction History

**(Dart-only)**

- `lib/pages/account.dart` — `showTxHistory` gains an optional `currentHeight`
  (sourced from `currentHeightProvider`) and computes per-tx confirmations
  (`currentHeight - tx.height + 1`, clamped ≥ 0, only for mined txs), passing it
  to each `TransactionTile`.
- `lib/widgets/theme.dart` — `TransactionTile` gained an optional
  `confirmations`. The title (built by `_buildTitle`) renders the `( N conf )`
  suffix at **80%** font size and slightly muted, **and** coexists with
  upstream's `→ contactName` recipient decoration — both can appear together.

## Switch Network page + Account List button + Account menu item

- **`lib/pages/networks.dart` (new):** radio-style selector (Zcash / Zcash Testnet
  / Zcash Regtest). Selecting a different network **switches immediately** (no
  confirmation dialog), prompting for a password only if the target DB is
  encrypted. The current network shows a "Current network" subtitle.
- **`lib/router.dart`:** registers `/networks`.
- **`lib/pages/accounts.dart`:** a **Switch Network** icon button (globe,
  `Icons.public`) as the first item in the Account List actions — before
  Settings and Sync. The **empty state** ("No accounts yet") is rendered by a
  separate `Scaffold` that does not build the `EditableList`/its AppBar, so it
  gets its own AppBar carrying the per-network title and the same globe
  Switch Network button, so networks can be switched before any account exists.
  The empty-state AppBar also carries a **Settings** icon button
  (`Icons.settings`) next to the Switch Network button, matching the populated
  account list, so settings are reachable before any account exists.
- **`lib/pages/account.dart`:** a **Network** item in the single-account page's
  popup menu, inserted between **Account Manager** and **Settings**; navigates to
  `/networks`.
- **Per-network title (`accounts.dart`):** the Account List title shows `zkool`
  on mainnet, `zkool (testnet)` / `zkool (regtest)` otherwise (`networkTitle`).
- **Per-network suffix on the single-account page (`account.dart`):** the
  single-account AppBar title appends a network suffix to the account name —
  `<name>` on mainnet, `<name> ( testnet )` / `<name> ( regtest )` otherwise.
  The page already watches `appSettingsProvider`, so the active network's
  machine name (`settings.net`) is mapped via `networkForName` →
  `networkSuffix` (new helper in `lib/network.dart`, returns `""` on mainnet);
  the title rebuilds automatically on a live network switch.
- **Account-list leading icon (`account.dart`):** a list icon (`Icons.list`) as
  the single-account AppBar's `leading`, to the left of the account name, that
  navigates to the account list (`go("/accounts")`).
- **Theme-adaptive logo (`assets/zcash.svg`, new):** a Zcash "Ƶ" glyph drawn with
  `currentColor`, tinted per network via a flutter_svg `colorFilter`.
  (Registered in `pubspec.yaml`.)

---

# UI Fix

## Account list: long-press to select

**(Dart-only)**

- `lib/pages/accounts.dart` — **long-press** (`onLongPressStart`) on an account
  row toggles its selection, the same as tapping the account avatar
  (`onSelectChanged`).

## Transaction TXID popup returns to account page

**(Dart-only)**

- `lib/pages/tx.dart` — after a successful broadcast and acknowledging the TXID
  dialog, navigate back to the **single-account page** at `/`
  (`AccountViewPage`, see `lib/router.dart`). There is **no** `/account` route —
  `/account/...` only has sub-routes (`/account/edit`, `/account/new`), so the
  earlier `go("/account")` landed nowhere. No `setState` after navigating (the
  page is left immediately, so updating `txId` would be dead state).

## Account import navigates to the account list

**(Dart-only)**

- `lib/pages/new_account.dart` — after an account import completes (the
  **Account Imported** dialog), navigate to the account **list** page at
  `/accounts` (note: `/` is the single-account view, **not** the list) instead
  of `pop()`, so the newly imported account is immediately visible. The
  transparent-address scan that may run mid-import (`showTransparentScan`) is a
  sub-step of this flow, so the navigation belongs here at the end of the import
  rather than inside the scan dialog. `lib/pages/sweep.dart` is left at the
  upstream behavior (invalidate `accountProvider` + `getAccountsProvider`, show
  "Scan Completed", `pop()` on close).

## Live per-account sync progress

**(Dart-only)**

- `lib/store.dart` — `SyncStateAccount.build` (the per-account progress card):
  when the account is part of the active sync, the displayed height is driven by
  the **live synchronizer progress** (`ss.height`) so the card climbs toward the
  chain tip in real time, instead of staying frozen at `account.height`:
  - `start: account.height` (was `max(ss.start, account.height)`).
  - `time: ss.time != 0 ? ss.time : account.time` (was `max(ss.time, account.time)`).

## Account list height not flagged stale on regtest

**(Dart-only)**

- `lib/store.dart` — `ProgressWidget` (the per-account block-height display, e.g.
  via `SmallProgressWidget` on the Account List) painted the height **red** when
  the latest block timestamp was older than 30 minutes. On **regtest** blocks are
  mined manually, so the chain tip's timestamp is almost always "old," leaving the
  height permanently red. The staleness check now skips regtest
  (`net != ZNetwork.regtest && syncAge > Duration(minutes: 30)`), reading the
  active network from `appSettingsProvider` (`net` → `networkForName`). Main/testnet
  still flag a stale sync in red; on regtest the height renders in the normal
  (white/default) style.

---

# Settings New

## Block Explorer dropdown

**(Dart-only)**

- `lib/settings.dart` — replaced the free-text Block Explorer field with a
  dropdown of named explorers; the URL text field is shown only for **Custom
  Explorer**:
  - `zcashexplorer.app` → `https://mainnet.zcashexplorer.app/transactions/{txid}`
  - `zcashinfo.com` → `https://zcashinfo.com/tx/{txid}`
  - `cipherscan.app` → `https://cipherscan.app/tx/{txid}` **(default)**
  - Custom Explorer → reveals a free-form URL field
- Stored in the existing `blockExplorer` property; `openBlockExplorer` substitutes
  `{txid}`.
- `lib/store.dart` — default `blockExplorer` changed to
  `https://cipherscan.app/tx/{txid}`.

## Network-aware explorers

- `lib/settings.dart`
  - **Explorers:** added `kTestnetBlockExplorers` and a `blockExplorersFor(net)`
    selector; `kBlockExplorers` are literal mainnet URLs, testnet uses literal
    `testnet.*` hosts, so testnet explorers appear as **named dropdown entries**
    instead of "Custom Explorer". Regtest offers no named explorers.
- `lib/pages/tx_view.dart` — the now-dead `{net}` substitution was removed.

## Changed defaults: FX auto-fetch + auto-sync interval

**(Dart-only)**

- `lib/store.dart` — two default values changed in `AppSettingsNotifier.build`.
  Both only affect **fresh installs / fresh per-network DBs**; any value the
  user has already stored wins:
  - **`get_fx` pref default `false` → `true`:** "Auto Fetch Market Price" is on
    by default. Note this makes the app poll the CoinGecko API (every minute, see
    `PriceNotifier`) without an explicit opt-in — turn it off in Settings or use
    Tor/offline mode.
  - **`sync_interval` prop default `"30"` → `"1"`:** auto-sync runs every minute
    instead of every 30 minutes, keeping balances/confirmation counts close to
    the chain tip by default.
