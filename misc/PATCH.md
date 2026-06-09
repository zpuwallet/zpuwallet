# PATCH

List of patches for custom zkool wallet

## Table of Contents

- [Build / regen notes](#build--regen-notes)
- **Wallet New**
  - [Multi-network support (testnet / regtest)](#multi-network-support-testnet--regtest)
  - [Fiat currency conversion](#fiat-currency-conversion)
  - ["Previous Set of Addresses" (Receive Funds)](#previous-set-of-addresses-receive-funds)
  - [Portable build: ship `zkool_portable.exe`](#portable-build-ship-zkool_portableexe)
- **Wallet Fix**
  - [Mnemonic import used the wrong receive-address index](#mnemonic-import-used-the-wrong-receive-address-index)
  - [Transparent-address scan default gap limit](#transparent-address-scan-default-gap-limit)
  - [Portable build: settings stored under `./db`](#portable-build-settings-stored-under-db)
- **UI New**
  - [Receive Funds: derivation paths + Previous button](#receive-funds-derivation-paths--previous-button)
  - [Confirmation count in Transaction History](#confirmation-count-in-transaction-history)
  - [Switch Network page + Account List button](#switch-network-page--account-list-button)
- **UI Fix**
  - [Account list: long-press to select](#account-list-long-press-to-select)
  - [Transaction TXID popup returns to account page](#transaction-txid-popup-returns-to-account-page)
  - [Transparent-scan dialog navigation + refresh](#transparent-scan-dialog-navigation--refresh)
- **Settings New**
  - [Market Price Currency dropdown](#market-price-currency-dropdown)
  - [Block Explorer dropdown](#block-explorer-dropdown)
  - [Network-aware explorers](#network-aware-explorers)

## Build / regen notes

- Rust + FRB changes require `RUSTFLAGS='--cfg zcash_unstable="nu7"'` and an FRB
  regen (`flutter_rust_bridge_codegen generate`) on a working build environment;
  generated files (`frb_generated.*`, `*.g.dart`, `*.freezed.dart`) are not
  hand-edited. On Windows, use `misc/codegen.ps1` (native MSVC + vcpkg OpenSSL),
  followed by `flutter pub get` + `dart run build_runner build
  --delete-conflicting-outputs` to regenerate `*.freezed.dart` / `*.g.dart`.
- Verify with `flutter pub get` + `flutter analyze`, then `flutter build
  windows` / `cargo check --features flutter`.
- Items marked **(Dart-only)** need no codegen/RUSTFLAGS rebuild.

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
> explorers**.

## Fiat currency conversion

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

---

# Wallet Fix

## Mnemonic import used the wrong receive-address index

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

## Transparent-address scan default gap limit

**(Dart-only)**

- `lib/store.dart` — `TransparentScan.gapLimit` default changed from **40** to
  **20**.

## Portable build: settings stored under `./db`

**(Dart-only)**

**Files:** `lib/prefs.dart` (new), `lib/main.dart`, `lib/store.dart`,
`lib/settings.dart`, `lib/utils.dart`, `lib/pages/db.dart`,
`lib/pages/splash.dart`, `lib/pages/disclaimer.dart`, `lib/pages/lwd_select.dart`

- **Problem:** the portable build already keeps its SQLite DBs and vault files in
  the local `./db` directory (see **Wallet New → Portable build**), but its
  *settings* did not follow suit. The app uses `SharedPreferencesAsync`, which on
  Windows/Linux persists to a per-user OS-native store — **not** a relocatable
  `shared_preferences.json` — so a portable copy lost its theme, selected
  database, FX/Tor settings, tutorial flags, etc. when moved, and left data behind
  in the user profile.
- **`lib/prefs.dart` (new):** `AppPrefs`, a drop-in wrapper mirroring the exact
  `SharedPreferencesAsync` method surface the app uses (`getString`/`getBool`/
  `getInt`, `setString`/`setBool`/`setInt`, `remove`, plus `init()`). It selects a
  backend from the existing `isPortable` getter:
  - **Portable** → a JSON file at `./db/settings.json` (via `getDataDirectory()` +
    `joinPath()`), with an in-memory cache and a temp-file-then-rename write so a
    crash mid-write can't leave a half-written file. A missing/corrupt file falls
    back to defaults instead of crashing.
  - **Non-portable** → delegates straight to a real `SharedPreferencesAsync()`, so
    behavior is **identical to before**.
- **`main.dart`:** calls `await AppPrefs().init()` right after `initDatadir(...)`
  so the portable cache is warm before first use (reads are also self-initializing,
  so this is belt-and-suspenders).
- **Call-site swap:** every `final prefs = SharedPreferencesAsync();` (15 sites
  across `store.dart`, `settings.dart`, `utils.dart`, `main.dart`, and the four
  `pages/*.dart` files) became `final prefs = AppPrefs();`; the per-file
  `shared_preferences` import was replaced with `package:zkool/prefs.dart`.
  `SharedPreferencesAsync` is now referenced only inside `prefs.dart`.
- **No migration:** first portable run starts with fresh defaults (existing
  native-store values are not imported).

---

# UI New

## Receive Funds: derivation paths + Previous button

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

**(Dart-only)**

- `lib/pages/account.dart` — `showTxHistory` computes per-tx confirmations
  (`currentHeight - tx.height + 1`, clamped ≥ 0, only for mined txs) via
  `currentHeightProvider` and passes it to each tile.
- `lib/widgets/theme.dart` — `TransactionTile` gained an optional
  `confirmations`; the title renders as e.g. `Sent ( 2 conf )` where the
  `( N conf )` suffix is **80%** of the label font size and slightly muted.

## Switch Network page + Account List button

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

---

# UI Fix

## Account list: long-press to select

**(Dart-only)**

- `lib/pages/accounts.dart`
  - **Long-press** (`onLongPressStart`) toggles the row's selection, the same as
    tapping the account avatar (`onSelectChanged`).

## Transaction TXID popup returns to account page

**(Dart-only)**

- `lib/pages/tx.dart` — after a successful broadcast and acknowledging the TXID
  dialog, navigate back to `/account`.

## Transparent-scan dialog navigation + refresh

**(Dart-only)**

- `lib/pages/sweep.dart` — on **Scan Completed** and on **Close**, invalidate
  `accountProvider` + `getAccountsProvider` (so a newly imported transparent
  account shows immediately) and navigate to the account list `/` (matching the
  SEED PHRASE popup behavior), instead of `pop()`.

---

# Settings New

## Market Price Currency dropdown

- `lib/settings.dart` — added a small **Market Price Currency** dropdown (compact,
  dense `FormBuilderDropdown`) listing the 15 supported currencies (BTC, USD, CNY,
  EUR, JPY, GBP, INR, RUB, BRL, CAD, AUD, MXN, KRW, TRY, VND).

> The fetch/convert plumbing is in **Wallet New → Fiat currency conversion**.

## Block Explorer dropdown

**(Dart-only)**

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

## Network-aware explorers

- `lib/settings.dart`
  - **Explorers:** added `kTestnetBlockExplorers` and a `blockExplorersFor(net)`
    selector; removed the `{net}` placeholder from `kBlockExplorers` (now literal
    mainnet URLs) and from the testnet default (now literal
    `testnet.cipherscan.app`), so testnet explorers appear as **named dropdown
    entries** instead of "Custom Explorer".
- `lib/pages/tx_view.dart` — the now-dead `{net}` substitution was removed.
