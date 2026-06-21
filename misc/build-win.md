# Building zkool for Windows locally (MSVC toolchain)

This guide explains how to compile zkool and produce **`zkool-%VERSION%.zip`**
on your own Windows machine using `build-win.ps1` — the **native MSVC** path that
**does not need MSYS2**.

> Prefer MSYS2/GNU? Use `build-win.ps1` (see `build-win.md`). This MSVC variant is
> an independent alternative; pick whichever toolchain your machine already has.

## How this works (same as CI, plus prebuilt OpenSSL)

CI builds the Windows app by letting **Flutter/cargokit** compile the Rust crate
with the **MSVC** toolchain during `flutter build windows` (driven by `fastforge`).
It works on GitHub's `windows-latest` runners because they ship **Perl + NASM**, so
the `vendored-openssl` feature can build OpenSSL from C source. Locally we usually
don't have those — and Strawberry Perl in particular is incompatible with the
current Rust openssl wrapper.

`build-win.ps1` builds **exactly the way CI does** — cargokit compiles the Rust,
no bypass — and changes only **one** thing: it injects `OPENSSL_*` environment
variables so `openssl-sys` links a **prebuilt vcpkg OpenSSL** instead of compiling
it. The key facts that make this work:

- **`OPENSSL_NO_VENDOR=1`** makes `openssl-sys` consume the prebuilt copy instead of
  vendoring. That env var overrides the forced `vendored` Cargo feature at build
  time, so `Cargo.toml` stays untouched.
- cargokit runs `rustup run stable cargo build --target x86_64-pc-windows-msvc
  --features=…` and passes the **current process environment straight through** to
  cargo. So setting `OPENSSL_*` + `RUSTFLAGS` in the PowerShell process is all cargo
  needs — no bypass, no manual cargo build, no DLL planting.
- The feature list comes from **`rust/cargokit.yaml`** (`cargo.release.extra_flags`),
  exactly like CI's `misc/mkcargokit_options.sh ledger > rust/cargokit.yaml`. The
  script writes that file.

In short (OpenSSL is installed **by the script** in vcpkg **manifest mode**):

0. **OpenSSL via manifest mode:** the repo-root `vcpkg.json` declares `openssl`,
   and the script runs `vcpkg install --x-manifest-root <repo> --x-install-root
   build\vcpkg_installed` to materialize it **into the project's `build\` tree**
   (not the shared `<vcpkg>\installed`). vcpkg uses **its own** bundled Perl — you
   install nothing. The first install is slow (~10–20 min); repeat runs restore
   from vcpkg's binary cache.
1. Write `rust/cargokit.yaml` so cargokit builds with `--features=ledger`.
2. Prepend the VS x64 tools to `PATH` (so cargo's link step uses MSVC's `link.exe`,
   not another `link.exe` on `PATH`), and set `OPENSSL_*` + `RUSTFLAGS` — all for the
   script's process only.
3. `flutter build windows --release` → cargokit compiles `rlz.dll` with MSVC, linking
   the vcpkg OpenSSL (**no Perl, no NASM**).
4. Zip the Release folder as `out\zkool-%VERSION%.zip`.

> The script changes **nothing globally**. The `PATH` tweak and the `OPENSSL_*` /
> `RUSTFLAGS` variables apply to its **own process only**, and `rust/cargokit.yaml`
> is the same file CI generates.

---

## 1. Prerequisites

| Tool | Why | How |
|------|-----|-----|
| **Rust (rustup) + `x86_64-pc-windows-msvc` target** | Builds the native `rust/` crate for the MSVC ABI. | The script auto-runs `rustup target add x86_64-pc-windows-msvc` if it's missing. |
| **Visual Studio Community 2026** with **"Desktop development with C++"** | Provides `cl.exe` / `link.exe` / the Windows SDK **and** — via the workload's components below — CMake, Ninja and clang-cl, so you don't install those separately. | Install via the **Visual Studio Installer** — see [§1a](#1a-installing-visual-studio-community-2026) for the exact components. *Community* / *Build Tools* edition is fine. |

> The script **auto-detects CMake, Ninja and clang-cl from the Visual Studio
> install** (via `vswhere -find`) and falls back to `PATH`. As long as the VS
> components in [§1a](#1a-installing-visual-studio-community-2026) are installed,
> **none of CMake / Ninja / LLVM need to be installed separately or be on `PATH`.**

| Tool | Why | How |
|------|-----|-----|
| **vcpkg** | Supplies a **prebuilt OpenSSL** so we don't build it from source (no Perl/NASM). | `git clone https://github.com/microsoft/vcpkg C:\vcpkg` then `C:\vcpkg\bootstrap-vcpkg.bat`. The script finds it via **`VCPKG_ROOT` → `where vcpkg` → `C:\vcpkg`**; set `VCPKG_ROOT` or pass `-VcpkgRoot` if it's elsewhere. |
| **OpenSSL via vcpkg (`x64-windows-static-md`)** | The MSVC-ABI OpenSSL that `rlz.dll` links against. **The script installs it for you in manifest mode** into `build\vcpkg_installed`. | No manual step — the repo-root `vcpkg.json` declares `openssl` and the script runs `vcpkg install` on each build (cached after the first ~10–20 min). Uses `x64-windows-static-md`, **not** `x64-windows-static`. |
| **Flutter SDK 3.44.2** | Builds the Windows app. | The script **clones Flutter 3.44.2 into `build-win\flutter`** automatically (like `zwallet`); you only need `git` on PATH. Pass `-FlutterDir` to reuse an existing SDK, or `-FlutterVersion ""` to use whatever `flutter` is on PATH. |
| **git** | Used to clone the Flutter SDK. | https://git-scm.com — add to PATH. |

> **No manual OpenSSL install needed.** `build-win.ps1` installs OpenSSL in vcpkg
> **manifest mode** on each run, materializing it into **`build\vcpkg_installed\x64-windows-static-md`**
> from the repo-root `vcpkg.json`. The first run builds OpenSSL (~10–20 min); after
> that vcpkg restores it from its binary cache, so repeat runs are fast. The
> install tree lives under `build\`, so `-Clean` wipes it along with everything else.

> **Why no Strawberry Perl / NASM / MSYS2 here?** Setting `OPENSSL_NO_VENDOR=1`
> makes `openssl-sys` consume vcpkg's prebuilt OpenSSL instead of compiling it from
> C source — and compiling from source is the only thing that needed Perl/NASM.
> vcpkg *does* use Perl to build OpenSSL, but it ships its own copy for that
> one-time step, so you never install one. No MSYS2 is involved at all.

Verify your setup before building (from PowerShell):

```powershell
rustup show                         # any host is fine; msvc target is auto-added
flutter doctor                      # "Windows" + "Visual Studio" checks green
cargo --version
# vcpkg is resolved from VCPKG_ROOT, then `where vcpkg`, then C:\vcpkg:
$env:VCPKG_ROOT                     # if set, this wins
where.exe vcpkg                     # else the dir of this vcpkg.exe is used
Test-Path C:\vcpkg\vcpkg.exe        # else the C:\vcpkg fallback must be True
# OpenSSL is installed by the script in manifest mode (build\vcpkg_installed) —
# nothing to verify by hand. vcpkg.json at the repo root declares the dependency:
Test-Path .\vcpkg.json              # must be True (the manifest the script reads)
```

> CMake, Ninja and clang-cl are **not** checked here — the build auto-detects them
> from the Visual Studio install (see [§1a](#1a-installing-visual-studio-community-2026)).

---

## 1a. Installing Visual Studio Community 2026

Install **Visual Studio Community 2026** with the **Visual Studio Installer**
(download it from <https://visualstudio.microsoft.com/>). In the installer, select
the **"Desktop development with C++"** workload, then make sure these components are
checked under the workload's **Installation details** pane (or the **Individual
components** tab):

- **MSVC v14x – VS C++ x64/x86 build tools (Latest)** — `cl.exe` / `link.exe`.
- **C++ CMake tools for Windows** — ships **both CMake and Ninja** that the build
  auto-detects (no separate CMake/Ninja install needed).
- **Windows 11 SDK** (latest) — headers/libs for the desktop runner.
- **C++/CLI support for v14x build tools (Latest)** — the "Latest MSVC" C++/CLI option.
- **C++ Clang tools for Windows** — provides **clang-cl** and the MSBuild **ClangCL**
  toolset that the `rive_common` plugin requires (otherwise the build fails with
  `MSB8020`).

> The build script auto-detects **CMake**, **Ninja** and **clang-cl** from this VS
> install via `vswhere -find` (falling back to `PATH`). With the components above
> installed, you do **not** need to install CMake / Ninja / LLVM separately or add
> them to `PATH`.

You can also add these to an existing install from the command line — e.g. for a
default Community 2026 path:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe" modify `
    --installPath "C:\Program Files\Microsoft Visual Studio\2026\Community" `
    --add Microsoft.VisualStudio.Workload.NativeDesktop `
    --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    --add Microsoft.VisualStudio.Component.VC.CMake.Project `
    --add Microsoft.VisualStudio.Component.Windows11SDK.22621 `
    --add Microsoft.VisualStudio.Component.VC.CLI.Support `
    --add Microsoft.VisualStudio.Component.VC.Llvm.Clang `
    --add Microsoft.VisualStudio.Component.VC.Llvm.ClangToolset `
    --quiet --norestart
```

---

## 1b. Fast Dart pre-flight (`flutter.ps1`)

Before the slow native build, run the **Dart-only** verification with
`flutter.ps1`. It compiles **no** Rust and needs **no** MSVC / vcpkg / OpenSSL —
it just runs `flutter pub get` and `flutter analyze` (and, optionally,
`dart run build_runner`). This surfaces Dart mistakes in **seconds** instead of
after a ~10-minute cargokit Rust compile.

```powershell
.\misc\flutter.ps1                 # flutter pub get + flutter analyze
.\misc\flutter.ps1 -BuildRunner    # + regenerate freezed/riverpod (*.g.dart/*.freezed.dart)
.\misc\flutter.ps1 -Watch          # build_runner in watch mode (Ctrl-C to stop)
.\misc\flutter.ps1 *>&1 | Tee-Object -FilePath build.log # flutter with logging
```

**When to use `-BuildRunner`:** only when you changed `@freezed` / `@riverpod`
declarations (or any annotation that drives generated `*.g.dart` / `*.freezed.dart`).
Adding plain functions / widgets / enums does **not** need it. To regenerate the
**flutter_rust_bridge** bindings instead, use `codegen.ps1` (see §4b) — that's a
different generator.

`flutter.ps1` provides Flutter the **same way** as `build-win.ps1` (clones the
pinned `3.44.2` into `build-win\flutter`, or `-FlutterDir <sdk>`, or
`-FlutterVersion ""` to use one on PATH), so the two scripts share the SDK.

> **Analyze is scoped to `lib\` (+ `test\`).** It deliberately does **not** analyze
> `build-win\flutter` (the cloned SDK) or `rust_builder\cargokit` (cargokit's
> internal `build_tool`, which has unresolved deps). Analyzing the whole tree from
> the repo root otherwise reports **thousands** of bogus issues from those
> third-party trees. `analysis_options.yaml` excludes them too, so editor/IDE
> analysis stays clean as well.

Recommended order whenever you've touched Dart and/or regenerated bindings:

```powershell
.\misc\flutter.ps1        # 1. cheap: pub get + analyze (fix any Dart errors here)
.\misc\build-win.ps1      # 2. full native build once analyze is clean
```

> If you only changed Dart (no Rust API change), you can skip `codegen.ps1` and go
> straight `flutter.ps1` → `build-win.ps1`.

**Options:**

```powershell
.\misc\flutter.ps1 -SkipPubGet                 # repeat runs; skip pub get
.\misc\flutter.ps1 -SkipAnalyze -BuildRunner   # only regenerate code, don't analyze
.\misc\flutter.ps1 -FlutterDir C:\flutter      # reuse an existing SDK
.\misc\flutter.ps1 -FlutterVersion ""          # use whatever 'flutter' is on PATH
```

If PowerShell blocks the script, run it for the current process only:

```powershell
powershell -ExecutionPolicy Bypass -File .\misc\flutter.ps1
```

---

## 2. Build

Open **PowerShell**, `cd` into the project root (where `pubspec.yaml` is), and run:

```powershell
.\misc\build-win.ps1
```

If PowerShell blocks the script with an execution-policy error, run it for the
current process only:

```powershell
powershell -ExecutionPolicy Bypass -File .\misc\build-win.ps1
```

The script will:

1. Clone Flutter (`3.44.2`) into `build-win\flutter` (first run only) and prepend
   its `bin\` to PATH for this process only. (Use `-FlutterDir` / `-FlutterVersion ""`
   to skip cloning — see §4.)
2. Check tools, locate Visual Studio (via `vswhere`), verify clang-cl / the ClangCL
   toolset (via `vswhere -find`), detect CMake + Ninja from the VS install (falling
   back to `PATH`), resolve the vcpkg root (`VCPKG_ROOT` → `where vcpkg` → `C:\vcpkg`),
   and add the `x86_64-pc-windows-msvc` Rust target if needed.
3. Read the version (`%VERSION%`) from `pubspec.yaml`.
4. **Install** `openssl:x64-windows-static-md` via vcpkg **manifest mode** (from
   the repo-root `vcpkg.json`) into `build\vcpkg_installed` — cached after the
   first run.
5. Write `rust/cargokit.yaml` with `--features=ledger` (same as CI's
   `mkcargokit_options.sh`).
6. Prepend the VS x64 tools to `PATH` and set `OPENSSL_NO_VENDOR=1` +
   `OPENSSL_DIR`/`OPENSSL_STATIC`/`OPENSSL_LIBS` + `RUSTFLAGS` — process-scoped only.
7. `flutter build windows --release` — cargokit compiles the Rust
   (`rustup run stable cargo build --target x86_64-pc-windows-msvc --features=ledger`),
   linking the vcpkg OpenSSL. cargokit bundles `rlz.dll` into the Release folder.
8. Zip the Release folder to **`out\zkool-%VERSION%.zip`**.

The **first build is slow** — cargokit compiles the whole zcash dependency tree
(~10+ minutes), and the manifest-mode `vcpkg install` builds OpenSSL once (~10–20
min). Subsequent builds reuse the cargo cache and restore OpenSSL from vcpkg's
binary cache into `build\vcpkg_installed`.

---

## 3. Output

When it finishes you'll see:

```
out\zkool-%VERSION%.zip
```

That zip's root contains the runnable Windows build — `zkool.exe`, its DLLs
(including `rlz.dll`), and the `data\` folder. Unzip it anywhere and run
`zkool.exe`. Because OpenSSL and SQLCipher are **statically** linked into
`rlz.dll`, there are no extra OpenSSL DLLs to ship.

---

## 4. Options

```powershell
# Skip `flutter pub get` on repeat builds:
.\misc\build-win.ps1 -SkipPubGet

# vcpkg installed somewhere other than C:\vcpkg (overrides VCPKG_ROOT / `where vcpkg`):
.\misc\build-win.ps1 -VcpkgRoot D:\vcpkg
# ...or just set the env var once and omit -VcpkgRoot:
$env:VCPKG_ROOT = "D:\vcpkg"; .\misc\build-win.ps1

# Use a different OpenSSL triplet (NOT recommended — see troubleshooting):
.\misc\build-win.ps1 -OpensslTriplet x64-windows-static-md

# Build with the crate's default features only (writes empty extra_flags):
.\misc\build-win.ps1 -Feature ""

# Use an already-installed Flutter SDK instead of cloning one:
.\misc\build-win.ps1 -FlutterDir C:\flutter

# Clone a different Flutter version (branch/tag; default 3.44.2):
.\misc\build-win.ps1 -FlutterVersion 3.27.0

# Use whatever 'flutter' is already on PATH (no clone):
.\misc\build-win.ps1 -FlutterVersion ""

# Wipe all build caches first (flutter clean + build\ + rust\target + .dart_tool):
.\misc\build-win.ps1 -Clean
```

> The script clones Flutter into `build-win\flutter` on first run; delete that
> folder to force a fresh re-clone. Your globally-installed Flutter (if any) is
> left untouched.

> **Switching Visual Studio versions (e.g. VS 2022 → 2026)?** CMake bakes the
> generator name into `build\windows\x64\CMakeCache.txt` and refuses to reuse a
> cache made by a different VS. The script detects this automatically and removes
> just the stale `CMakeCache.txt` + `CMakeFiles\` (keeping the Rust target cache),
> so you normally don't need `-Clean` for it. `-Clean` remains the heavier
> hammer if you also want the Rust build redone from scratch.

> To force a full Rust recompile, delete `target\x86_64-pc-windows-msvc\` (or the
> whole `build\` + `target\`) before running.

---

## 4b. Regenerating the flutter_rust_bridge bindings (`codegen.ps1`)

When you change the Rust API surface under `rust/src/api/` — adding/removing a
`pub` function, or changing a signature like `Coin::open_database` — you must
regenerate the **flutter_rust_bridge (FRB)** bindings so the Dart side matches the
Rust side. The generated files are:

- `lib/src/rust/**` (Dart bindings, e.g. `lib/src/rust/api/coin.dart`)
- `rust/src/frb_generated.rs` (Rust wire glue)

> **Do not hand-edit the generated files** (see `CLAUDE.md`). Regenerate them with
> `codegen.ps1` instead.

`flutter_rust_bridge_codegen generate` runs `cargo expand` over the crate to
discover its API, which means it must **compile** the crate — so it needs the
**same toolchain + environment as a real build**. In particular, without the
`OPENSSL_*` injection it fails the same way a from-source build does (`cc` / `gcc`
errors while vendoring OpenSSL/secp256k1). `codegen.ps1` mirrors `build-win.ps1`'s
prerequisite checks and **process-scoped** environment, then runs the codegen
instead of `flutter build windows`:

- `RUSTFLAGS='--cfg zcash_unstable="nu7"'` — the NU7 flag (required by `CLAUDE.md`).
- Prepends the VS x64 tools to `PATH` so MSVC's `link.exe` wins.
- Sets `CARGO_BUILD_TARGET=x86_64-pc-windows-msvc` (the rustup host here is GNU,
  which is what fails the from-source OpenSSL build).
- Injects `OPENSSL_NO_VENDOR=1` + `OPENSSL_DIR`/`OPENSSL_STATIC`/`OPENSSL_LIBS`/… so
  `openssl-sys` links the **prebuilt vcpkg OpenSSL** (no Perl, no NASM).

**Prerequisites:** the same as the build — Rust, Visual Studio (C++), vcpkg, and
a vcpkg OpenSSL (`x64-windows-static-md`). Note `codegen.ps1` still expects OpenSSL
in the **classic** `<vcpkg>\installed` tree, so install it once with
`<vcpkg>\vcpkg.exe install openssl:x64-windows-static-md` before running codegen
(unlike `build-win.ps1`, which installs OpenSSL itself via manifest mode). It also needs
the **`flutter_rust_bridge_codegen` binary**, whose version **must match** the
`flutter_rust_bridge` dependency pinned in `pubspec.yaml` / `rust/Cargo.toml`
(currently **`2.12.0`**) — a mismatch produces bindings that break at load time.

You don't install that binary yourself: `codegen.ps1` installs it **locally** into
**`build-win\frb`** (via `cargo install --root`) on first run and prepends its `bin\`
to `PATH` for the script's process only. **Nothing is installed globally** into
`~/.cargo/bin`, and `build-win\` is gitignored — the codegen toolchain stays
self-contained next to the cloned Flutter SDK.

Run it from the project root (where `pubspec.yaml` is):

```powershell
# First run auto-installs the codegen into build-win\frb (local), then regenerates:
.\misc\codegen.ps1

# Force a fresh local (re)install of the pinned 2.12.0, then regenerate:
.\misc\codegen.ps1 -InstallCodegen
```

If PowerShell blocks the script, run it for the current process only:

```powershell
powershell -ExecutionPolicy Bypass -File .\misc\codegen.ps1
```

After it finishes, review the diff under `lib/src/rust/` and
`rust/src/frb_generated.rs`, then build as usual with `build-win.ps1`.

**Options:**

```powershell
# vcpkg installed somewhere other than C:\vcpkg (else VCPKG_ROOT / `where vcpkg`):
.\misc\codegen.ps1 -VcpkgRoot D:\vcpkg

# Pin a different FRB codegen version (must match pubspec.yaml / rust/Cargo.toml):
.\misc\codegen.ps1 -FrbVersion 2.12.0 -InstallCodegen

# Install/use the codegen binary somewhere other than build-win\frb:
.\misc\codegen.ps1 -CodegenRoot D:\tools\frb
```

> Delete `build-win\frb` to force a clean reinstall of the codegen binary (or just
> pass `-InstallCodegen`). It's gitignored along with the rest of `build-win\`.

> Like `build-win.ps1`, this script changes **nothing globally** — the `PATH` tweak
> and `OPENSSL_*` / `RUSTFLAGS` / `CARGO_BUILD_TARGET` variables apply to its **own
> process only**.

The codegen-specific troubleshooting items are noted in §5 below (they share the
OpenSSL / `link.exe` / `RUSTFLAGS` causes with the build).

---

## 5. Troubleshooting

- **`flutter` / `cargo` / `vcpkg.exe` not found** — the tool isn't on PATH (or vcpkg
  can't be located). Re-open PowerShell after editing PATH. vcpkg is resolved from
  `VCPKG_ROOT` → `where vcpkg` → `C:\vcpkg`; if it's elsewhere, set `$env:VCPKG_ROOT`
  or pass `-VcpkgRoot <path>`.
- **`cmake` / `ninja` / `clang-cl` not found** — the script auto-detects these from
  the Visual Studio install (via `vswhere -find`) and falls back to `PATH`. If it
  warns they're missing, install the VS **"C++ CMake tools for Windows"** and
  **"C++ Clang tools for Windows"** components (see
  [§1a](#1a-installing-visual-studio-community-2026)).
- **`git` not found / Flutter clone fails** — the script clones Flutter into
  `build-win\flutter` and needs `git` on PATH (https://git-scm.com). To skip the
  clone, pass `-FlutterDir <existing-sdk>` or `-FlutterVersion ""` to use a
  Flutter already on PATH. Delete `build-win\flutter` to force a clean re-clone.
- **`LNK2038: mismatch detected for 'RuntimeLibrary' ('MT_StaticRelease' vs
  'MD_DynamicRelease')`** — wrong OpenSSL triplet. Rust-msvc uses the **dynamic**
  CRT (`/MD`), so OpenSSL must be `x64-windows-static-md`, **not**
  `x64-windows-static` (which is `/MT`). Re-run with the default triplet.
- **`unresolved external symbol` from OpenSSL during the Rust link** — ensure
  `OPENSSL_STATIC=1` and `OPENSSL_LIBS=libssl:libcrypto` (colon-separated). The
  script sets these; if building manually, export them and confirm
  `libssl.lib` / `libcrypto.lib` exist in
  `<vcpkg>\installed\x64-windows-static-md\lib`.
- **`openssl-sys` tries to build from source / asks for Perl** — `OPENSSL_NO_VENDOR`
  wasn't seen by cargo. The script sets it; if you build manually, export
  `OPENSSL_NO_VENDOR=1` and `OPENSSL_DIR=<vcpkg>/installed/x64-windows-static-md`.
  Do **not** install Strawberry Perl to "fix" this — it's incompatible with the
  current openssl wrapper.
- **`link.exe` errors / wrong `link.exe` (e.g. `___chkstk_ms`, MSYS2 link)** — a
  non-MSVC `link.exe` won on `PATH`. The script prepends the VS x64 tools
  (`VC\Tools\MSVC\<ver>\bin\Hostx64\x64`) to `PATH` so MSVC's `link.exe` wins;
  confirm with `(Get-Command link.exe).Source` — it should point into the VS
  install, not `C:\msys64`. cargo finds the MSVC `INCLUDE`/`LIB` via the registry
  on its own, so a full `vcvars64.bat` import isn't needed.
- **`MSB8020: The build tools for ClangCL ... cannot be found`** — the
  `rive_common` plugin requires the MSBuild ClangCL toolset. Install the VS
  components *"C++ Clang Compiler for Windows"* and *"MSBuild support for LLVM
  (clang-cl) toolset"*, e.g. (adjust `--installPath` to your VS edition/year):
  ```powershell
  & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe" modify `
      --installPath "C:\Program Files\Microsoft Visual Studio\2026\Community" `
      --add Microsoft.VisualStudio.Component.VC.Llvm.Clang `
      --add Microsoft.VisualStudio.Component.VC.Llvm.ClangToolset `
      --quiet --norestart
  ```
  The script pre-checks for this (via `vswhere -find ...\clang-cl.exe`) and fails
  early with the same hint.
- **`error C2338 ... STL1011` / `<experimental/coroutine> ... deprecated`** — a
  newer MSVC STL (VS 2026 / MSVC 14.5x) hard-errors on the deprecated
  `<experimental/coroutine>` header that the `flutter_inappwebview_windows` and
  `local_auth_windows` plugins include. The script sets
  `CL=/D_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS` (process-scoped) to
  silence it for every target. If you build manually, `set` that `CL` value first.
- **Flood of `warning C4244` / `C4458` from `flutter_inappwebview_windows` /
  WebView2** — pure noise from third-party plugin sources under MSVC's `/W4`
  (int64→int conversions and member-hiding). The script appends `/wd4244 /wd4458`
  to `CL` to silence them; the build succeeds with or without it. If you build
  manually, add those to your `CL` value alongside the coroutine define.
- **Flood of `warning ... -Wnontrivial-memcall` in `rive_common` / harfbuzz** —
  newer **clang-cl** (the ClangCL toolset `rive_common` forces) warns on `memcpy`
  of a non-trivially-copyable type, hundreds of times. The script sets
  `CCC_OVERRIDE_OPTIONS=^-Wno-nontrivial-memcall`, which the clang driver reads
  (and `cl.exe` ignores). The leading `^` **appends** the flag, so it lands after
  the plugin's own `/WX` and fully silences the warning — unlike the
  `-Wno-error=nontrivial-memcall` form in `windows/CMakeLists.txt`, which an
  ordering quirk demotes-but-doesn't-silence (kept there as the CI safety net).
  If you build manually, `set CCC_OVERRIDE_OPTIONS=^-Wno-nontrivial-memcall`.
- **Script stops with "OpenSSL ... was not produced by the manifest-mode
  install"** — the `vcpkg install` step failed. Scroll up for the vcpkg error
  (commonly a missing triplet or a broken vcpkg checkout). Confirm `vcpkg.json`
  exists at the repo root and that `<vcpkg>\vcpkg.exe` works, then re-run.
- **`vcpkg install openssl` is very slow** — expected on the **first** build; vcpkg
  compiles OpenSSL once and caches the result in its binary cache. Subsequent runs
  restore it into `build\vcpkg_installed` quickly. (`-Clean` removes `build\`, so
  the next build re-materializes — but still from the binary cache, not a rebuild.)
- **Build finishes but `rlz.dll` is missing from the Release folder** — cargokit's
  Rust build failed (scroll up in the log for the cargo error). The script checks
  for `rlz.dll` and stops if it's absent. With static OpenSSL there's no other
  native dependency beyond the MSVC runtime that Flutter already bundles.
- **Rust build fails on a zcash crate** — make sure `RUSTFLAGS` is set. The script
  sets `--cfg zcash_unstable="nu7"`; if building manually you must export it.
- **Wrong feature compiled / `ledger` not enabled** — check `rust\cargokit.yaml`.
  The script writes it each run from `-Feature`; cargokit reads
  `cargo.release.extra_flags` from it (same file CI generates).
- **Clean rebuild** — delete `build\` and `target\x86_64-pc-windows-msvc\`, then rerun.

### `flutter.ps1` (Dart pre-flight)

- **`flutter analyze` reports a missing generated symbol** (e.g. an undefined
  `*Provider` or `_$...` mixin) — a `@freezed` / `@riverpod` declaration changed but
  its generated file wasn't refreshed. Re-run `flutter.ps1 -BuildRunner` to
  regenerate `*.g.dart` / `*.freezed.dart`.
- **`flutter analyze` reports an undefined FRB symbol** (e.g. a Rust function or a
  changed signature like `openDatabase(... coin:)`) — the flutter_rust_bridge
  bindings are stale. Regenerate them with `codegen.ps1` (§4b), not `-BuildRunner`.
- **`git` not found / Flutter clone fails** — same as the build: pass
  `-FlutterDir <existing-sdk>` or `-FlutterVersion ""` to avoid cloning.

### `codegen.ps1` (FRB binding regeneration)

- **`flutter_rust_bridge_codegen` not found / local install failed** — `codegen.ps1`
  installs it **locally** into `build-win\frb` (via `cargo install --root`) and needs
  `cargo` on PATH to do so. If the install failed, scroll up for the cargo error;
  re-run with `-InstallCodegen` to force a fresh local install. The version must
  match the `flutter_rust_bridge` dependency in `pubspec.yaml` / `rust/Cargo.toml`.
- **"Using a flutter_rust_bridge_codegen that is NOT the local build-win\frb copy"** —
  a global codegen on PATH was used instead of the local one. Re-run with
  `-InstallCodegen` to install the pinned version into `build-win\frb`; the script
  prepends that bin\ to PATH so the local copy wins.
- **`Error: cargo expand returned empty output`** — the crate failed to compile during
  codegen, almost always for the **same reasons as a failed build**: missing
  `RUSTFLAGS`, a non-MSVC `link.exe` winning on `PATH`, or `openssl-sys` trying to
  vendor OpenSSL from source (`cc` / `gcc` errors). `codegen.ps1` sets
  `RUSTFLAGS`, prepends the MSVC tools, and injects `OPENSSL_NO_VENDOR=1` + the
  `OPENSSL_*` vars to fix all three — see the OpenSSL / `link.exe` / `RUSTFLAGS`
  items above.
- **Bindings regenerate but the app crashes on launch / FRB hash mismatch** — the
  codegen binary version didn't match the pinned `flutter_rust_bridge` dependency.
  Re-run `codegen.ps1 -InstallCodegen` to install `2.12.0`, regenerate, and rebuild.
