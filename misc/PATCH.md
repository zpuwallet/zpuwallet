# PATCH

List of patches for custom zkool wallet

## Change summary

- fix: settings fix ( NoHardware )
- fix: proxy improvements & fiat conversion
- fix: max spend improve & backup seed page
- fix: improve receive funds page
- feat: testnet & regtest support on UI

## Build / regen notes

- Rust + FRB changes require `RUSTFLAGS='--cfg zcash_unstable="nu7"'` and an FRB
  regen (`flutter_rust_bridge_codegen generate`) on a working build environment;
  generated files (`frb_generated.*`, `*.g.dart`, `*.freezed.dart`) are not
  hand-edited.
- Verify with `flutter pub get` + `flutter analyze`, then `flutter build
  windows` / `cargo check --features flutter`.
- Items marked **(Dart-only)** need no codegen/RUSTFLAGS rebuild.

---

# Wallet New

## Multi-network support (testnet / regtest)

**feat: testnet & regtest support on UI**

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
  mainnet `0`). `migrate_sapling_addresses` now uses the **resolved** coin.
  `try_open` no longer overwrites the `coin` prop on every open — it seeds from
  the filename **only when missing**, so an explicit choice is never clobbered.
- **`lib/network.dart` (new):** single source of truth —
  `enum ZNetwork { mainnet, testnet, regtest }` with a `NetworkInfo` per network
  (coin id, label, db suffix, default LWD + alternatives, default explorer,
  light-node default) plus helpers `networkForCoin`, `networkForName`,
  `baseDbName`, `dbNameForNetwork`, `networkTitle`, `networkAccent`, and a
  `ZNetworkX` extension. Each `NetworkInfo` carries a `dbSuffix`: mainnet uses
  an empty suffix (`""`) so its DB keeps the base name `zkool` and existing
  installs are untouched; testnet/regtest use `-testnet` / `-regtest`.
  `baseDbName`/`dbNameForNetwork` strip and re-apply the suffix. Regtest
  defaults to a Zebra full node (`defaultIsLightNode: false`).
- **Live network switch (`lib/store.dart`):**
  - `SynchronizerNotifier.stop()` tears down the in-flight sync (`cancelSync`,
    cancels the progress subscription, clears state) so no stream keeps writing
    to the previous network's DB pool.
  - `openAndWireDatabase(...)` — shared open-flow (password-retry loop, seed
    per-network defaults, set LWD/Tor/proxy, publish to `coinContext`), reused by
    both startup and switching.
  - `_seedNetworkDefaults(...)` — on first open of a network DB, seeds `lwd`,
    `is_light_node`, and `block_explorer` props from `NetworkInfo` when absent.
  - `switchNetwork(ref, net, askPassword:)` — stop sync + mempool → reset
    selected account → open the per-network DB → persist `database` + `network`
    prefs → invalidate all network-scoped providers → restart auto-sync and the
    mempool listener.
- **Startup & new-DB callers:** `splash.dart` reads the persisted `network` pref
  and passes it as the explicit `coin` to `openDatabase`, restoring the
  last-used network on launch (falls back to `null` → stored prop for existing
  single-network installs). `db.dart` opens the Database Manager's "new
  database" with the currently-active network's coin.

> See also **UI New → Switch Network page** and **Settings New → Network-aware
> servers & explorers**.

## Fiat currency conversion

**fix: proxy improvements & fiat conversion**

**Files:** `rust/src/api/network.rs`, `rust/src/budget.rs`,
`rust/src/api/transaction.rs`, `rust/src/frb_generated.rs`,
`lib/src/rust/api/network.dart`, `lib/src/rust/api/transaction.dart`,
`lib/src/rust/frb_generated.dart`, `lib/store.dart`, `lib/store.freezed.dart`,
`lib/store.g.dart`, `lib/utils.dart`, `lib/widgets/input_amount.dart`,
`lib/pages/accounts.dart`, `lib/pages/account.dart`

- **Rust price fetch (`network.rs`):** `get_coingecko_price` now takes a
  `currency` argument, lowercases it, requests
  `…?ids=zcash&vs_currencies={cur}&x_cg_demo_api_key={api}`, and reads the price
  via `.pointer("/zcash/{currency}")`. The old fixed `Usd`/`ZcashUSD` structs
  were removed.
- **Historical / tx prices (`budget.rs`, `transaction.rs`):**
  `get_historical_prices_all`, `get_historical_prices` and
  `fill_missing_tx_prices` thread the selected `currency` through (CoinGecko
  `vs_currency={currency}`).
- **FRB bindings:** `get_coingecko_price` and `fill_missing_tx_prices` gained a
  second `String currency` argument, wired through the generated Dart and Rust
  bindings (arg order: `api` → `currency` [→ `c`]).
- **Settings model (`store.dart`):** `AppSettings` gained an `fxCurrency` field,
  persisted via SharedPreferences (`fx_currency`, default `usd`) and pushed into
  the `PriceNotifier` auto-fetch.
- **Display (`utils.dart`, `input_amount.dart`, `accounts.dart`,
  `account.dart`):** added `fxCurrencies` + an `fxSymbol()` helper; all
  hard-coded "USD"/"$" labels now use the selected currency code and symbol.

> The currency picker UI is in **Settings New → Market Price Currency
> dropdown**.

## "Previous Set of Addresses" (Receive Funds)

**fix: improve receive funds page**

A new button that moves the account's active diversifier index backward — the
inverse of *Next Set of Addresses*.

**Files:** `rust/src/account.rs`, `rust/src/api/account.rs`,
`rust/src/frb_generated.rs`, `lib/src/rust/api/account.dart`,
`lib/src/rust/frb_generated.dart`

- **Rust core (`rust/src/account.rs`):** added `generate_prev_dindex`, the
  inverse of `generate_next_dindex`:
  - Reads `(aindex, dindex)`; if `dindex == 0`, returns `0` unchanged.
  - For Sapling-enabled accounts, scans **downward** from `dindex - 1` for the
    closest **valid** Sapling diversifier (skipping invalid indices), floored at
    0, and re-points the stored Sapling address. On Ledger (`hw != 0`) it accepts
    the index via `get_hw_next_diversifier_address`.
  - For accounts without Sapling, simply decrements by 1.
  - Persists the new `dindex`, then ensures the matching transparent receive
    address row exists.
- **Rust API wrapper (`rust/src/api/account.rs`):**
  ```rust
  #[cfg_attr(feature = "flutter", frb)]
  pub async fn generate_prev_dindex(c: &Coin) -> Result<u32> {
      let mut connection = c.get_connection().await?;
      crate::account::generate_prev_dindex(&c.network(), &mut connection, c.account).await
  }
  ```
- **Dart wrapper (`lib/src/rust/api/account.dart`):**
  ```dart
  Future<int> generatePrevDindex({required Coin c}) =>
      RustLib.instance.api.crateApiAccountGeneratePrevDindex(c: c);
  ```
- **FRB bindings:** `wire__crate__api__account__generate_prev_dindex_impl` +
  dispatcher arm `48 => …` in `frb_generated.rs`; abstract method
  `crateApiAccountGeneratePrevDindex` using `funcId: 48` in
  `frb_generated.dart`. Because FRB assigns ids in declaration order, inserting
  the two new functions (`generate_prev_dindex` and `set_proxy`) shifted the
  ids of every later function — the whole `funcId` table was renumbered by the
  regen (hence the large `frb_generated.*` diff), so this is a full codegen
  output, not a hand-appended id. Reuses existing serializers
  (`sse_encode_box_autoadd_coin`, `sse_decode_u_32`).

> The button + handler UI is in **UI New → Receive Funds: derivation paths +
> Previous button**.

## Portable build: ship `zkool_portable.exe`

**fix: proxy improvements & fiat conversion**

**Files:** `windows/CMakeLists.txt`, `lib/utils.dart`, `lib/main.dart`,
`lib/pages/db.dart`, `lib/vault.dart`

- **`windows/CMakeLists.txt`:** after `install(TARGETS …)`, an `install(CODE …)`
  step runs `${CMAKE_COMMAND} -E copy_if_different` to copy `zkool.exe` →
  `zkool_portable.exe`, so `flutter build windows` produces both binaries side by
  side. (Uses `execute_process` + `copy_if_different` for CMake 3.14
  compatibility.)
- **`utils.dart`:** added `isPortable` (true when the running executable is named
  `zkool_portable…`), `getDataDirectory()` and a `joinPath()` helper. The
  portable build stores its data in a local `./db` directory next to the
  executable; the normal build keeps using the OS application-documents
  directory.
- **`main.dart`, `db.dart`, `vault.dart`:** switched from
  `getApplicationDocumentsDirectory()` to `getDataDirectory()` so the data dir,
  the DB-manager listing and the vault key files all honor portable mode.

## Server-list sync tool (`servers/`, new)

**fix: proxy improvements & fiat conversion**

**Files:** `servers/README.md`, `servers/package.json`, `servers/sync.ts`,
`servers/tsconfig.json`, `servers/.gitignore`, `servers/servers.json`,
`servers/servers_testnet.json`

- A standalone TypeScript tool that fetches the current Zcash light-wallet server
  list from `hosh.zec.rocks` (full URL + uptime metadata) and writes it out;
  run via `npm run sync` / `tsx sync.ts`. Build-time/maintenance tooling, not
  part of the shipped app.
- **Mainnet/testnet split:** the hosh feed mixes both chains in one array with no
  network field, so each run classifies every server and writes **two** files —
  the `--out` path (mainnet, default `servers.json`) and a sibling with
  `_testnet` inserted before `.json` (testnet, default `servers_testnet.json`).
  A server is treated as **testnet** when its hostname matches `/testnet/i`, it
  uses a known testnet port (`19067`), or its block `height` is at/above a
  threshold; everything else is mainnet.
- **Live height threshold:** the threshold is not hardcoded — each run fetches
  the current testnet tip from `https://api.testnet.cipherscan.app/api/blocks?limit=1&offset=0`
  and rounds **down to the nearest 100k** (e.g. tip 4,053,973 → 4,000,000). The
  sync fails fast (throws) if the tip can't be fetched/parsed.
- **Filtering / flags:** online-only is now the **default** (`online === true`);
  `--all` includes offline servers, `--no-tor` drops `.onion` servers, and the
  new node-version filter (also on by default) keeps only servers meeting a
  per-implementation minimum (`Zebra >= 5.0.0`, `MagicBean >= 6.20.0`) — disable
  it with `--no-filter-node-version`. (The legacy `--online-only` flag is still
  accepted but now redundant.)
- **Output shape:** the `Output` object is `{ source, fetchedAt, count, servers }`
  sorted online-first → uptime band (desc) → USA ping (asc); the former
  `groups` (uptime-band) array was removed.

---

# Wallet Fix

## Mnemonic import used the wrong receive-address index

**fix: proxy improvements & fiat conversion**

**Files:** `rust/src/account.rs`, `rust/src/frb_generated.rs` (regen)

- When importing a wallet by mnemonic, the first receive address came out as
  `m/44'/133'/0'/0/3` (or `.../0/7`) instead of `.../0/0`.
- **Root cause:** the diversifier index (`dindex`) was derived from the *unified*
  full viewing key's `default_address()`. The unified address is dominated by the
  Orchard receiver, whose default valid diversifier is a non-zero value (3, 7, …),
  so the Sapling receive address inherited that non-zero index.
- **Fix:** force diversifier index **0**.
  - **Transparent & Orchard** addresses are valid at every index → always use
    index `0`.
  - **Sapling** uses `find_address(0)`, which returns index `0` whenever valid
    (the common case) and only falls back to the next valid index in the rare
    case that diversifier 0 is invalid.
  - The shared account diversifier index stored via `update_dindex` is therefore
    `0` in the normal case, giving a receive address of `m/44'/133'/aindex'/0/0`.
- **NOTE:** Rust change — only takes effect after the crate is recompiled.

## "Max" button fee fix (Recipient Pays Fee)

**fix: max spend improve & backup seed page** — **(Dart-only)**

Fixes "Not enough funds, 0.00015 more ZEC required" when sending the full
balance via the Max button. Reuses the existing `recipientPaysFee` flag.

- `lib/pages/send.dart`
  - `SendPage` tracks a `maxSelected` flag: set when **Max** is clicked, cleared
    when the amount is manually edited afterwards, and reset on form clear.
  - `onSend` passes `(recipients, maxSelected)` to the Extra Options page.
  - `Send2Page` gained a `maxSelected` parameter; when true the **Recipient Pays
    Fee** switch defaults to on, so the fee is deducted from the spend amount.
- `lib/router.dart` — `/send2` route accepts either a bare `List<Recipient>` or a
  `(List<Recipient>, bool)` record.

## Transparent-address scan default gap limit

**fix: max spend improve & backup seed page** — **(Dart-only)**

- `lib/store.dart` — `TransparentScan.gapLimit` default changed from **40** to
  **20**.

---

# UI New

## Theme system: Zcash dark-yellow + Zkool theme

**fix: settings fix ( NoHardware )** / **fix: max spend improve & backup seed
page** — **(Dart-only)**

**Files:** `lib/theme_mode.dart` (new), `lib/main.dart`, `lib/widgets/theme.dart`

- **`lib/theme_mode.dart` (new):**
  - `themeModeProvider` — a non-generated provider that defaults to **Dark** on
    first launch and persists the user's choice via SharedPreferences
    (`theme_mode` key).
  - `zcashDarkTheme` — charcoal surfaces (`#121212`/`#1C1C1C`) with the Zcash gold
    accent **`#F4B728`** applied to AppBar foreground, dividers, tab bar, progress
    indicators, switches and icons.
  - `zcashLightTheme` — `ColorScheme.fromSeed` on the same gold for brand
    consistency.
  - **Zkool theme:** new `AppTheme { zkool, dark, light, system }` enum (replaces
    direct use of `ThemeMode` for the persisted preference; same `theme_mode`
    key, default still **dark**). New `zkoolPinkTheme` (Material Pink `#E91E63`
    seed, light) restores the original pre-gold look (pre-commit `8fe8f35e`).
    Helpers `themeModeFor(AppTheme)` / `lightThemeFor(AppTheme)` map the selection
    to a `ThemeMode` + light `ThemeData`. `ThemeModeNotifier` / `themeModeProvider`
    now hold `AppTheme`.
- **`lib/main.dart`:** `MaterialApp.router` is wrapped in a `Consumer`; it derives
  `themeMode` and `theme` from the selected `AppTheme` (dark theme slot
  unchanged), replacing the previous hard-coded `ThemeMode.system` +
  `ThemeData.light()/dark()`.

> The Theme dropdown UI is in **Settings New → Theme dropdown**.

## Backup Seed & Keys page

**fix: max spend improve & backup seed page** — **(Dart-only)**

- `lib/pages/account.dart`
  - New **Backup Seed & Keys** toolbar icon (`Icons.save`) between *Edit Account*
    and *Remove Account*; opens the **Viewing Keys** page after `authenticate()`.
  - **Viewing Keys page** shows the seed phrase by default (`showSeed = true`).
    The toolbar button toggles show/hide (`key` / `key_off` icon, *Show Seed
    Phrase* / *Hide Seed Phrase* tooltip); hiding is immediate, revealing requires
    `authenticate()`.

## Receive Funds: derivation paths + Previous button

**fix: improve receive funds page**

**File:** `lib/pages/receive.dart`

- **Derivation paths (Dart-only for this part):** a small, monospace,
  hint-colored line under each address showing how it was derived, computed in
  Dart from `account.aindex`, `addresses.diversifierIndex`, and the network name.
  - Coin type from `getNetworkName`: mainnet → `133'`, test/regtest → `1'`.
  - **Transparent** path: `m/44'/{coinType}'/{aindex}'/0/{diversifierIndex}`.
  - **Shielded** (Sapling / Orchard / Unified): `m/32'/{coinType}'/{aindex}'`,
    diversifier index shown separately.
  - Wired into all four address tiles (Unified, Orchard-only, Sapling,
    Transparent). New helpers: `getNetworkName`, `coinType`, `transparentPath()`,
    `shieldedPath()`, `derivationLabel()`, `derivationInfo()`.
- **"Previous Set of Addresses" button:** new `derivePrevID` showcase key + AppBar
  `IconButton` (`Icons.skip_previous`, tooltip *"Previous Set of Addresses"*)
  **between** the Sweep button and the Next Set button. New `onPrevAddress()`
  handler guards against going below index 0 (shows *"Already at the first set of
  addresses"* snackbar), otherwise calls `generatePrevDindex(c:)`, refreshes the
  displayed addresses, and rebuilds. Added to the tutorial showcase list.

> The Rust/FRB backing for the Previous button is in **Wallet New → "Previous Set
> of Addresses"**.

## Confirmation count in Transaction History

**fix: max spend improve & backup seed page** — **(Dart-only)**

- `lib/pages/account.dart` — `showTxHistory` computes per-tx confirmations
  (`currentHeight - tx.height + 1`, clamped ≥ 0, only for mined txs) via
  `currentHeightProvider` and passes it to each tile.
- `lib/widgets/theme.dart` — `TransactionTile` gained an optional
  `confirmations`; the title renders as e.g. `Sent ( 2 conf )` where the
  `( N conf )` suffix is **80%** of the label font size and slightly muted.

## Switch Network page + Account List button

**feat: testnet & regtest support on UI**

- **`lib/pages/networks.dart` (new):** radio-style selector (Zcash / Zcash Testnet
  / Zcash Regtest). Selecting a different network **switches immediately** (no
  confirmation dialog), prompting for a password only if the target DB is
  encrypted. The current network shows a "Current network" subtitle.
- **`lib/router.dart`:** registers `/networks`.
- **`lib/pages/accounts.dart`:** a **Switch Network** icon button (globe) as the
  first item in the Account List actions — between the `+` New Account button and
  Settings.
- **Per-network title (`accounts.dart`):** the Account List AppBar shows `zkool`
  on mainnet, `zkool (testnet)` / `zkool (regtest)` otherwise (`networkTitle`).
- **Theme-adaptive logo (`assets/zcash.svg`, new):** a Zcash "Ƶ" glyph drawn with
  `currentColor`, tinted per network via a flutter_svg `colorFilter`. Replaces
  the temporary `misc/icon.png`. (Registered in `pubspec.yaml`.)

## Tor onion logo on Settings

**fix: proxy improvements & fiat conversion**

**Files:** `assets/tor.svg` (new), `lib/settings.dart`, `pubspec.yaml`

- Added **`assets/tor.svg`** — an onion-mark icon (concentric rings + vertical
  stem) drawn with `stroke="currentColor"` so it can be tinted to match the theme.
- Added the `flutter_svg` dependency and registered the asset.
- The proxy button now renders the Tor onion via `SvgPicture.asset("assets/tor.svg",
  colorFilter: ColorFilter.mode(primary, BlendMode.srcIn))` instead of a Material
  icon.

---

# UI Fix

## Dark-mode account cards: outline instead of gradient

**fix: settings fix ( NoHardware )** — **(Dart-only)**

- `lib/widgets/theme.dart` (`DisplayPanel`) — in dark mode the panel now renders
  a flat `surface` card with a gold accent **outline** (no gradient, no shadow).
  Light mode keeps the original gradient/shadow. Affects the account cards on the
  launch page and other panels using `DisplayPanel`.

## Account list: long-press to select + card spacing

**fix: settings fix ( NoHardware )** — **(Dart-only)**

- `lib/pages/accounts.dart`
  - **Long-press** (`onLongPressStart`) toggles the row's selection, the same as
    tapping the account avatar (`onSelectChanged`).
  - **Spacing:** each card now has `8px` vertical padding (~16px gap). The reorder
    `ValueKey` moved to the wrapping `Padding` so drag-and-drop reordering still
    works.

## Account view page: Edit & Remove actions in the AppBar

**fix: settings fix ( NoHardware )** — **(Dart-only)**

- `lib/pages/account.dart`
  - Added **Edit Account** (`edit`) and **Remove Account** (red `delete`) as
    dedicated AppBar icon buttons, positioned **between "Sync this account" and
    "Receive Funds"** (away from "Send Funds" to avoid disrupting the send flow).
    Both disabled until account data loads.
  - `onEdit(account)` — pushes `/account/edit` with the account as a
    `List<Account>`, same as the Account List edit action.
  - `onRemove(account)` — confirm → `deleteAccount` → `GoRouter.go("/")`.
  - The overflow (⋮) menu now holds only Fetch Tx Prices / Export / Charts / ZSA.

## Transaction TXID popup returns to account page

**fix: max spend improve & backup seed page** — **(Dart-only)**

- `lib/pages/tx.dart` — after a successful broadcast and acknowledging the TXID
  dialog, navigate back to `/account`.

## Transparent-scan dialog navigation + refresh

**fix: max spend improve & backup seed page** — **(Dart-only)**

- `lib/pages/sweep.dart` — on **Scan Completed** and on **Close**, invalidate
  `getAccountsProvider` (so a newly imported transparent account shows
  immediately) and navigate to the account list `/` (matching the SEED PHRASE
  popup behavior), instead of `pop()`.

## Mobile responsive fix

**feat: testnet & regtest support on UI** — **(Dart-only)**

A narrow-screen layout pass; breakpoint is a simple `MediaQuery` width check
(`width < 600` ⇒ mobile), no new dependencies.

- `lib/pages/account.dart` — on **mobile** the crowded AppBar action row (Edit
  Account, Backup Seed & Keys, Remove) is hidden (`if (!isMobile)`) and surfaced
  instead in the existing `PopupMenuButton` (`edit` / `backup` / `remove`). On
  **desktop/wide** the icon buttons remain.
- `lib/settings.dart` — the Light Node Server field is wrapped in a `Builder`
  branching on the same `isMobile` check: **mobile** returns the dropdown
  full-width with the label inline as `labelText`; **desktop/wide** keeps the
  label-plus-dropdown `Row` (dropdown box 360 → 324px).

---

# Settings New

## Theme dropdown

**fix: settings fix ( NoHardware )** / **fix: max spend improve & backup seed
page** — **(Dart-only)**

- `lib/settings.dart` — added a **Theme** dropdown at the **top** of the settings
  form (above "Light Node"). Initially Dark / Light / System; later extended to
  **Zkool / Dark / Light / System** once the Zkool theme landed.

> Theme definitions are in **UI New → Theme system**.

## Market Price Currency dropdown

**fix: proxy improvements & fiat conversion**

- `lib/settings.dart` — added a small **Market Price Currency** dropdown (compact,
  dense `FormBuilderDropdown`) listing the 15 supported currencies (BTC, USD, CNY,
  EUR, JPY, GBP, INR, RUB, BRL, CAD, AUD, MXN, KRW, TRY, VND).

> The fetch/convert plumbing is in **Wallet New → Fiat currency conversion**.

## Block Explorer dropdown

**fix: max spend improve & backup seed page** — **(Dart-only)**

- `lib/settings.dart` — replaced the free-text Block Explorer field with a
  dropdown of named explorers; the URL text field is shown only for **Custom
  Explorer**:
  - `zcashexplorer.app` → `https://{net}.zcashexplorer.app/transactions/{txid}`
  - `zcashinfo.com` → `https://zcashinfo.com/tx/{txid}`
  - `cipherscan.app` → `https://cipherscan.app/tx/{txid}` **(default)**
  - Custom Explorer → reveals a free-form URL field
- Stored in the existing `blockExplorer` property; `openBlockExplorer` substitutes
  `{net}`/`{txid}` (templates without `{net}` are mainnet-only).
- `lib/store.dart` — default `blockExplorer` changed to
  `https://cipherscan.app/tx/{txid}`.

## Network-aware servers & explorers

**feat: testnet & regtest support on UI**

- `lib/settings.dart`
  - **Servers:** the Light Node Server dropdown is network-specific (a `switch`
    on the active network) — **mainnet** loads the bundled `servers.json`,
    **testnet** loads the bundled `servers_testnet.json` (both via
    `loadTopServers`) and falls back to the network's hardcoded defaults when
    that bundled list is empty, and **regtest** runs against a local full node so
    it only offers its hardcoded default.
  - **`lib/utils.dart`:** `loadTopServers` gained an `asset` parameter (defaults
    to `servers/servers.json`; pass `servers/servers_testnet.json` for testnet)
    so the same loader serves both lists.
  - **`pubspec.yaml`:** registers `servers/servers_testnet.json` as a bundled
    asset alongside `servers/servers.json`.
  - **Explorers:** added `kTestnetBlockExplorers` and a `blockExplorersFor(net)`
    selector; removed the `{net}` placeholder from `kBlockExplorers` (now literal
    mainnet URLs) and from the testnet default (now literal
    `testnet.cipherscan.app`), so testnet explorers appear as **named dropdown
    entries** instead of "Custom Explorer".
- `lib/pages/tx_view.dart` — the now-dead `{net}` substitution was removed.

---

# Settings Fix

## Biometric "NoHardware" no longer blocks Settings

**fix: settings fix ( NoHardware )** — **(Dart-only)**

- `lib/utils.dart` (`authenticate()`) — added `case "NoHardware":` and `case
  auth_error.biometricOnlyNotSupported:` to the error switch. On devices with no
  biometric hardware, instead of a blocking error dialog + denial, it shows a
  non-blocking snackbar ("Biometric lock unavailable on this device - access not
  protected") and returns `true` so the user can still open Settings. Genuine
  failures (cancellation, lockout, unknown codes) still hit `default` and deny.

## External proxy support (socks5/socks5h/http/https, remote DNS) + Tor default

**fix: proxy improvements & fiat conversion**

**Files:** `rust/src/api/coin.rs`, `rust/src/net/zebra.rs`, `rust/Cargo.toml`,
`lib/settings.dart`

- **`Coin.proxy` field + `set_proxy` (`coin.rs`):** the `Coin` struct gains a
  `pub proxy: String` field (empty = no proxy; supports `socks5://`,
  `socks5h://`, `http://`, `https://`). New `frb(sync)` method
  `pub fn set_proxy(self, proxy: String) -> Result<Self>` stores it.
- **Light-node (gRPC) path (`coin.rs`):** the `client()` connection match now
  has an arm `0 if !self.proxy.is_empty() => connect_over_proxy(&self.url,
  &self.proxy)` (precedence: Tor > proxy > direct). `connect_over_proxy` builds
  a tonic `Channel` over a proxied stream produced by `open_proxied_stream`,
  which:
  - **`socks5h://`** sends the hostname to the proxy (remote DNS, makes `.onion`
    light-wallet servers reachable),
  - **`socks5://`** resolves the host *locally* (`tokio::net::lookup_host`) and
    hands the IP to the proxy,
  - **`http://` / `https://`** open an HTTP `CONNECT` tunnel
    (`http_connect_tunnel`).
- **`zebra.rs` — full-node (JSON-RPC) path:** `ZebraClient::new` now takes a
  `proxy` argument; when set, the `reqwest::Client` is built with
  `Proxy::all(proxy)` (reqwest understands `socks5`/`socks5h`/`http`/`https`), so
  `.onion` Zebra endpoints work through Tor.
- **`Cargo.toml`:** `reqwest` gains the `socks` feature; new dependency
  `tokio-socks = "0.5.2"` backs the SOCKS connection handling.
- **`settings.dart` — Tor default:** the Tor button fills in a `socks5h://` URL by
  default (`socks5h://127.0.0.1:9150` on Windows, `:9050` elsewhere) so `.onion`
  servers resolve correctly out of the box.

## Light Node Server dropdown sizing

**fix: proxy improvements & fiat conversion** / **fix: max spend improve & backup
seed page** — **(Dart-only)**

- `lib/settings.dart` — first made compact (a `Row` with an `Expanded` label plus
  a fixed-width ~180px dense `FormBuilderDropdown`, `isExpanded: true`,
  `OutlineInputBorder`, ellipsized items + a "Custom…" entry), then widened from
  `180` to `360` (~2×) for legibility. (Later made responsive on mobile — see
  **UI Fix → Mobile responsive fix**.)

## New account: default Restore birth height to latest block

**fix: settings fix ( NoHardware )** — **(Dart-only)**

- `lib/pages/new_account.dart` (`onSave`) — when "Restore" is on and the
  birth-height field is left empty, it now fetches the current tip height fresh
  via `getCurrentHeight` (and updates `currentHeightProvider`) instead of falling
  back to a low/stale value, then uses that as the birth height. Added
  `import 'package:zkool/src/rust/api/network.dart';`.
