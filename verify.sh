#!/usr/bin/env bash
#
# CommitOnce end-to-end verification.
#
# One command that re-runs every check this repository claims, in order, and prints a
# PASS/FAIL summary with the true exit code:
#
#   bash verify.sh
#
# What it does:
#   1. checks the prerequisites and fails with a specific message for each one that is missing
#   2. builds both programs (SBPFv3) via scripts/build.sh
#   3. verifies that every declare_id! matches its deploy-keys/*-keypair.json pubkey
#   4. checks formatting (cargo fmt --all --check)
#   5. runs the Rust suite against the compiled SBF artifact in LiteSVM
#   6. runs the benchmark test with its output visible
#   7. runs the SDK typecheck, build, test suite and dual-format check
#   8. checks the brand assets against the site palette
#   9. checks the documentation: links resolve, evidence logs are UTF-8, quoted test counts
#      are counts that exist, and no corrected claim has crept back
#  10. checks that every tracked text file is valid UTF-8 and free of mojibake
#  11. prints a PASS/FAIL summary and exits non-zero if anything failed or did not run
#
# What it does NOT do, and does not claim:
#   * It does not deploy anything, to any cluster.
#   * It does not contact a Solana cluster. The Rust suite runs in-process through LiteSVM;
#     the SDK suite is pure TypeScript.
#   * It does not audit the code. Passing this script means the recorded checks reproduce on
#     this machine. It is not evidence that the program is safe, and the program is unaudited.
#   * It does not verify anything it did not run: a step that could not run is reported as
#     NOT RUN, never as a pass, and NOT RUN also produces a non-zero exit code.
#   * It does not check that the SDK works as an installed package. That needs the network,
#     and this script is deliberately hermetic. Run `node scripts/check-package.mjs` for it.
#
# Environment. Rust and the Solana/Anchor toolchains for this project run under WSL2 Ubuntu,
# where scripts/build.sh and scripts/test.sh force HOME=/home/dell2u because that is where
# cargo, avm-managed anchor, the Solana CLI and the nvm-managed Node live. This script does
# the same, and stops with a clear error if that home directory is absent, rather than
# letting the build fail later with a confusing cargo or anchor error.
#
# Run it with bash. It is not POSIX sh: it uses arrays and shopt.

set -uo pipefail

# ---------------------------------------------------------------------------------------
# Locate the repository and set up the environment the build scripts expect.
# ---------------------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT" || {
    echo "FATAL: could not change directory to $REPO_ROOT" >&2
    exit 1
}

# The toolchain home. Overriding HOME is only correct when that home actually exists; on a
# machine whose toolchains live elsewhere, forcing it would hide them instead of finding them.
# Configurable for the same reason the scripts make it configurable: so this branch can be
# exercised on a machine that would always take it otherwise.
TOOLCHAIN_HOME="${COMMIT_ONCE_TOOLCHAIN_HOME:-/home/dell2u}"
if [ -d "$TOOLCHAIN_HOME" ]; then
    export HOME="$TOOLCHAIN_HOME"
fi

# A non-interactive shell does not load nvm, so the nvm-managed Node is not on PATH unless it
# was already inherited. Load it if Node is missing and nvm is present.
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

export PATH="$TOOLCHAIN_HOME/solana-current/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

# Same defaults as scripts/build.sh and scripts/test.sh.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/home/dell2u/cot-target}"
export COMMIT_ONCE_DEPLOY_DIR="${COMMIT_ONCE_DEPLOY_DIR:-$CARGO_TARGET_DIR/deploy}"

# ---------------------------------------------------------------------------------------
# Which toolchain runs the SDK checks.
#
# This project has a split toolchain, and it is not a stylistic choice: the Rust and Solana
# toolchains run under WSL2, while `node_modules/` here was installed by the Windows pnpm.
# That matters because this dependency tree contains *platform-specific native binaries* —
# `@typescript+typescript-win32-x64` (TypeScript 7 is a native executable), `@esbuild/win32-x64`,
# `@rolldown/binding-win32-x64-msvc` and `lightningcss-win32-x64-msvc`. None of those can
# execute under Linux, so running `pnpm` inside WSL against this tree cannot work, and
# pnpm does not merely fail — it first tries to purge and reinstall the whole tree, then
# aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY.
#
# So the SDK steps are delegated to the Windows toolchain through WSL interop. The
# detection below is deliberately evidence-based (look for the win32 native packages)
# rather than guessed from `uname`, and if the bridge is unavailable the script reports the
# SDK steps as NOT RUN with the exact command to run by hand — never as a pass.
# ---------------------------------------------------------------------------------------

REPO_ROOT_WIN=""
SDK_MODE="native"
if [ "$(uname -s)" = "Linux" ] && ls -d "$REPO_ROOT"/node_modules/.pnpm/@typescript+typescript-win32-* >/dev/null 2>&1; then
    if command -v cmd.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
        REPO_ROOT_WIN="$(wslpath -w "$REPO_ROOT" 2>/dev/null)"
        [ -n "$REPO_ROOT_WIN" ] && SDK_MODE="windows-interop"
    fi
fi

# Run an SDK command in whichever toolchain actually owns node_modules.
sdk_run() {
    if [ "$SDK_MODE" = "windows-interop" ]; then
        local out rc
        out="$(mktemp)"
        # `cd /d` is required: cmd.exe does not inherit the WSL working directory.
        cmd.exe /c "cd /d $REPO_ROOT_WIN && $*" >"$out" 2>&1
        rc=$?
        tr -d '\r' <"$out"
        rm -f "$out"
        return "$rc"
    fi
    "$@"
}

echo "=== CommitOnce verification ==="
echo "repository:            $REPO_ROOT"
echo "date (UTC):            $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "HOME:                  $HOME"
echo "CARGO_TARGET_DIR:      $CARGO_TARGET_DIR"
echo "COMMIT_ONCE_DEPLOY_DIR:$COMMIT_ONCE_DEPLOY_DIR"
echo "SBPF_ARCH:             ${SBPF_ARCH:-v3 (default)}"
echo "SDK toolchain mode:    $SDK_MODE${REPO_ROOT_WIN:+  ($REPO_ROOT_WIN)}"

# ---------------------------------------------------------------------------------------
# Result bookkeeping.
# ---------------------------------------------------------------------------------------

STEP_NAMES=()
STEP_STATUS=()
STEP_NOTES=()
FAILED=0
NOT_RUN=0

record() {
    local name="$1" status="$2" note="${3:-}"
    STEP_NAMES+=("$name")
    STEP_STATUS+=("$status")
    STEP_NOTES+=("$note")
    case "$status" in
        FAIL) FAILED=$((FAILED + 1)) ;;
        "NOT RUN") NOT_RUN=$((NOT_RUN + 1)) ;;
    esac
}

run_step() {
    local name="$1"
    shift
    echo
    echo "--- $name"
    echo "    \$ $*"
    local rc=0
    "$@" || rc=$?
    if [ "$rc" -eq 0 ]; then
        record "$name" PASS ""
        echo "    ok"
        return 0
    fi
    echo "    FAILED (exit $rc)" >&2
    record "$name" FAIL "exit $rc"
    return 1
}

print_summary() {
    echo
    echo "=== summary ==="
    local i=0
    while [ "$i" -lt "${#STEP_NAMES[@]}" ]; do
        printf '  %-52s %-8s %s\n' \
            "${STEP_NAMES[$i]}" "${STEP_STATUS[$i]}" "${STEP_NOTES[$i]}"
        i=$((i + 1))
    done
    echo
    echo "Not verified by this run: deployment of any kind, any Solana cluster, and the"
    echo "security of the code. CommitOnce is unaudited; see SECURITY.md."
}

finish() {
    print_summary
    local total="${#STEP_NAMES[@]}"
    if [ "$FAILED" -ne 0 ] || [ "$NOT_RUN" -ne 0 ]; then
        echo "RESULT: FAIL ($FAILED failed, $NOT_RUN not run, of $total steps)"
        echo "exit code: 1"
        exit 1
    fi
    echo "RESULT: PASS ($total steps ran and passed)"
    echo "exit code: 0"
    exit 0
}

# ---------------------------------------------------------------------------------------
# Step 0: prerequisites. Every missing item is reported by name, with what to do about it.
# ---------------------------------------------------------------------------------------

PREREQ_ERRORS=()

require_cmd() {
    local cmd="$1" hint="$2"
    command -v "$cmd" >/dev/null 2>&1 || PREREQ_ERRORS+=("$cmd not found in PATH — $hint")
}

require_cmd bash "this script is bash; run it with: bash verify.sh"
require_cmd cargo "install Rust; rust-toolchain.toml pins 1.98.0 (https://rustup.rs)"
require_cmd solana-keygen "install the Solana CLI; cargo-build-sbf comes from the same release"
require_cmd anchor "install the Anchor CLI, pinned to 1.2.0 (Anchor.toml, docs/ARCHITECTURE.md)"
require_cmd sed "coreutils are required for the declare_id! check"

if [ "$SDK_MODE" = "native" ]; then
    require_cmd node "install Node.js >= 20.18.0 (required by @solana/kit)"
    require_cmd pnpm "install pnpm 11.24.0 (pinned by packageManager in package.json)"
else
    # node_modules holds win32-only native binaries, so the SDK checks must run on Windows.
    # Verify the bridge actually works instead of assuming it does.
    if ! cmd.exe /c "pnpm -v" >/dev/null 2>&1; then
        PREREQ_ERRORS+=("cmd.exe cannot reach a Windows pnpm — the SDK checks need the Windows toolchain because node_modules contains win32-only native binaries (TypeScript 7, esbuild, rolldown, lightningcss). Install pnpm on Windows, or delete node_modules and run 'pnpm install' inside WSL to rebuild it for Linux, which will then break the Windows side instead.")
    fi
fi

if [ ! -d "$TOOLCHAIN_HOME" ]; then
    PREREQ_ERRORS+=("$TOOLCHAIN_HOME does not exist — scripts/build.sh and scripts/test.sh force HOME=$TOOLCHAIN_HOME (WSL2 Ubuntu), which is where the cargo, Solana, Anchor and Node toolchains live. Without it cargo cannot create its registry directory and anchor loses its wallet path. Run this script inside that WSL2 environment, or change HOME in scripts/build.sh and scripts/test.sh to match your toolchain location.")
fi

if [ ! -f "$REPO_ROOT/scripts/build.sh" ] || [ ! -f "$REPO_ROOT/scripts/test.sh" ]; then
    PREREQ_ERRORS+=("scripts/build.sh and/or scripts/test.sh are missing — this does not look like the CommitOnce repository root")
fi

if [ ! -d "$REPO_ROOT/programs/commit-once" ]; then
    PREREQ_ERRORS+=("programs/commit-once is missing — this does not look like the CommitOnce repository root")
fi

if [ ! -d "$REPO_ROOT/node_modules" ]; then
    PREREQ_ERRORS+=("node_modules is missing — run: pnpm install --frozen-lockfile")
fi

# Node version gate: @solana/kit requires >= 20.18.0 (packages/sdk/package.json engines).
# In interop mode the relevant Node is the Windows one, so ask that side.
NODE_VERSION=""
if [ "$SDK_MODE" = "windows-interop" ]; then
    NODE_VERSION="$(cmd.exe /c "node -v" 2>/dev/null | tr -d '\r\n' | sed 's/^v//')"
elif command -v node >/dev/null 2>&1; then
    NODE_VERSION="$(node -v 2>/dev/null | sed 's/^v//')"
fi

if [ -n "$NODE_VERSION" ]; then
    NODE_MAJOR="${NODE_VERSION%%.*}"
    NODE_REST="${NODE_VERSION#*.}"
    NODE_MINOR="${NODE_REST%%.*}"
    case "$NODE_MAJOR" in
        ''|*[!0-9]*) PREREQ_ERRORS+=("could not parse the Node version from 'node -v' (got '$NODE_VERSION')") ;;
        *)
            if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 18 ]; }; then
                PREREQ_ERRORS+=("Node $NODE_VERSION is too old — @solana/kit requires >= 20.18.0")
            fi
            ;;
    esac
elif [ "$SDK_MODE" = "windows-interop" ]; then
    PREREQ_ERRORS+=("could not determine the Windows Node version through cmd.exe; @solana/kit requires >= 20.18.0")
fi

if [ "${#PREREQ_ERRORS[@]}" -gt 0 ]; then
    echo
    echo "MISSING PREREQUISITES — nothing was verified." >&2
    for error in "${PREREQ_ERRORS[@]}"; do
        echo "  - $error" >&2
    done
    record "prerequisites" FAIL "${#PREREQ_ERRORS[@]} missing"
    finish
fi

echo
echo "prerequisites: ok"
record "prerequisites" PASS ""

# ---------------------------------------------------------------------------------------
# Step 1: build both programs. This also re-verifies program IDs internally and exits 1 on
# mismatch; step 2 repeats the check independently, from the keypairs, so that a bug in the
# build script cannot hide a program-ID mismatch.
# ---------------------------------------------------------------------------------------

BUILD_OK=0
if run_step "program build (bash scripts/build.sh)" bash scripts/build.sh; then
    BUILD_OK=1
fi

# ---------------------------------------------------------------------------------------
# Step 2: declare_id! vs deploy-keys/*-keypair.json.
#
# A program deployed at an address other than its compiled-in declare_id! refuses to run, so
# these two must agree. This step does not depend on the build output: it reads the committed
# keypairs and the sources, so it runs even when the build failed.
# ---------------------------------------------------------------------------------------

verify_program_ids() {
    local keys=()
    shopt -s nullglob
    keys=("$REPO_ROOT"/deploy-keys/*-keypair.json)
    shopt -u nullglob

    if [ "${#keys[@]}" -eq 0 ]; then
        echo "    no deploy-keys/*-keypair.json found in $REPO_ROOT/deploy-keys" >&2
        echo "    The program IDs are derived from these keypairs, so this check CANNOT RUN." >&2
        echo "    .gitignore lists deploy-keys/, so a fresh clone may not contain them." >&2
        echo "    Expected files: deploy-keys/commit_once-keypair.json and" >&2
        echo "                    deploy-keys/demo_counter-keypair.json" >&2
        echo "    Restore them, then re-run. Reporting this as a failure rather than a skip." >&2
        return 1
    fi

    local status=0
    local k name crate src want got
    for k in "${keys[@]}"; do
        name="$(basename "$k" -keypair.json)"
        crate="${name//_/-}"
        src="$REPO_ROOT/programs/${crate}/src/lib.rs"

        if [ ! -f "$src" ]; then
            echo "    FAIL $name: no source file at programs/${crate}/src/lib.rs" >&2
            status=1
            continue
        fi

        if ! want="$(solana-keygen pubkey "$k" 2>/dev/null)"; then
            echo "    FAIL $name: solana-keygen could not read $k" >&2
            status=1
            continue
        fi

        got="$(sed -n 's/.*declare_id!("\([^"]*\)").*/\1/p' "$src" | head -1)"
        if [ -z "$got" ]; then
            echo "    FAIL $name: no declare_id! found in programs/${crate}/src/lib.rs" >&2
            status=1
            continue
        fi

        if [ "$want" != "$got" ]; then
            echo "    FAIL $name: keypair=$want declare_id!=$got" >&2
            status=1
        else
            echo "    ok   $name = $got"
        fi
    done

    return "$status"
}

run_step "declare_id! matches deploy-keys (independent check)" verify_program_ids

# ---------------------------------------------------------------------------------------
# Steps 3 to 5: formatting, the Rust suite, then the benchmark with output visible.
#
# Formatting is checked here because CI checks it, and a `cargo fmt --all --check` failure is
# the kind of thing that should be caught before a push rather than by a red build. The
# workspace was not rustfmt-clean until this step existed — 53 hunks across 8 files, all of
# them unnoticed because nothing local ran the formatter.
# ---------------------------------------------------------------------------------------

# `cargo fmt --all` formats workspace members, and `programs-native/native-guard` is excluded
# from the workspace so `anchor build` will not try to generate an IDL for it. Excluded means
# unformatted unless it is named separately, which is how this step would have quietly stopped
# covering the newest crate in the repository.
# ---------------------------------------------------------------------------------------
# The environment block in scripts/build.sh, on both branches.
#
# The maintainer machine always takes the first branch, so the portable one — the one a
# judge, a contributor or CI takes — would otherwise never be executed by anything. That
# is exactly how the hardcoded HOME survived for so long: `verify.sh` checked whether
# /home/dell2u exists and then called a script that overrode the decision, and nothing
# ran the other path to notice.
# ---------------------------------------------------------------------------------------

run_step "script environment block, both branches (bash scripts/check-script-env.sh)" \
    bash scripts/check-script-env.sh

run_step "formatting (cargo fmt --all --check)" bash -c \
    'cargo fmt --all --check && cargo fmt --manifest-path programs-native/native-guard/Cargo.toml --check'

if [ "$BUILD_OK" -eq 1 ]; then
    run_step "Rust suite (bash scripts/test.sh, LiteSVM on the compiled SBF)" bash scripts/test.sh

    run_step "benchmarks, output visible (cargo test -p commit-once --test benchmarks)" \
        cargo test -p commit-once --test benchmarks -- --nocapture
else
    record "Rust suite (bash scripts/test.sh)" "NOT RUN" "program build failed"
    record "benchmarks, output visible" "NOT RUN" "program build failed"
fi

# ---------------------------------------------------------------------------------------
# Steps 6 to 10: the SDK. These do not depend on the compiled program — the SDK suite is pure
# TypeScript — so they run regardless of whether the build succeeded.
#
# **The order below matters, and getting it wrong is invisible on a working copy.** The SDK
# must be BUILT before the consumers are typechecked: `@commitonce/solana` resolves through
# `dist/types/index.d.ts`, and `dist/` is gitignored. On a fresh clone the consumers cannot
# resolve the module until the build has run, and typechecking them first fails with
# `TS2307: Cannot find module '@commitonce/solana'`. This script had exactly that bug — it
# passed for months on a machine where `dist/` already existed, and the first CI run on a
# clean checkout found it.
# ---------------------------------------------------------------------------------------

run_step "SDK typecheck (pnpm --filter @commitonce/solana typecheck)" \
    sdk_run pnpm --filter @commitonce/solana typecheck

run_step "SDK build (pnpm --filter @commitonce/solana build)" \
    sdk_run pnpm --filter @commitonce/solana build

# The demo and the examples consume the SDK, so they are the real test of whether its public
# API still works. They live in the workspace precisely so that breaking one fails a build
# instead of rotting silently in a directory nothing compiles.
#
# Serialised deliberately. TypeScript 7 is a native executable, and letting pnpm run three of
# them at once was observed to abort with SIGABRT (exit 134) on this machine under memory
# pressure, which showed up as a flaky verification step. Typechecking three small projects in
# parallel saves well under a second, so the trade is not worth a nondeterministic result.
run_step "consumers typecheck (pnpm -r typecheck: demo and all four examples)" \
    sdk_run pnpm -r --workspace-concurrency=1 typecheck

run_step "SDK tests (pnpm --filter @commitonce/solana test)" \
    sdk_run pnpm --filter @commitonce/solana test

# The dual-format build is only worth claiming if it actually loads both ways, so the check
# imports the built package through both the `import` and the `require` condition and
# compares the two builds, rather than trusting that dist/esm and dist/cjs exist.
run_step "SDK resolves under both ESM and CJS (pnpm --filter @commitonce/solana check:dual)" \
    sdk_run pnpm --filter @commitonce/solana check:dual

# ---------------------------------------------------------------------------------------
# Brand consistency. The mark lives in assets/brand/ and the site points at it, so this
# asserts the SVG palette still matches apps/web/styles.css, that the compact mark has not
# grown back the duplicate that is invisible below 48px, and that every exported PNG exists.
# It needs no rasterizer, so it runs anywhere Node does.
# ---------------------------------------------------------------------------------------

run_step "brand assets consistent (node scripts/check-brand.mjs)" \
    sdk_run node scripts/check-brand.mjs

# ---------------------------------------------------------------------------------------
# Cross-language constants. Six values are declared twice — once in Rust, once in TypeScript —
# because the SDK cannot import from an onchain program. Nothing checked that the copies agreed,
# so a change to the program's retention bounds would leave the SDK validating against the old
# range: `prepare()` would build a transaction the program then rejects with `InvalidRetention`,
# and the failure would surface at the cluster rather than at the call site. This also ties the
# SDK's receipt size to the number the Rust suite pins, and checks the rent derivation still has
# all three of its inputs.
#
# It also checks the **version pins** — litesvm and Rust — against the versions every tracked
# text file quotes. That is the same defect class as the SBPF arch flag, and it has happened
# four times here: the manifest moves and something else keeps stating the old value as
# current. The README, the judge readme, the submission form and the project description all
# claimed SBPFv2 for a round after the build moved to v3, and CI was pinned to v2 the whole
# time.
#
# It also checks that **no document or script pins HOME to an absolute path** without
# testing it first. Three scripts did, which undid this file's own careful check one level
# down; then two markdown "Reproduce" blocks did, which a reader would copy verbatim and
# break their own shell. The scope is every tracked text file, because the first version
# named the three scripts and the markdown was sitting right there.
#
# The scope is every tracked text file rather than a list of documents, because the first
# version named four documents and this script quotes the Rust pin in a prerequisite hint —
# so it sat outside the check and drifted unnoticed. Historical narrative is explicitly
# allowed; a version stated as what the manifest pins is not. Hermetic.
#
# And the **error range**: the program gained a twelfth error and four documents kept saying
# "6000-6010". The codes are implicit — Anchor assigns 6000 + the variant index — so the range
# is derived by counting variants, which is also why inserting one in the middle renumbers
# everything after it. Hermetic.
# ---------------------------------------------------------------------------------------

run_step "SDK constants agree with the program (node scripts/check-constants.mjs)" \
    sdk_run node scripts/check-constants.mjs

# ---------------------------------------------------------------------------------------
# The quickstart's own script. `docs/QUICKSTART.md` Step 4 told readers to run
# `node packages/sdk/quickstart.mjs` and **that file did not exist**, so the documented path
# failed at the first thing a newcomer tried. It exists now, and it asserts the four claims
# the document makes rather than only printing them, so the document cannot drift from the
# package. Needs the SDK built, which the step above this one guarantees.
# ---------------------------------------------------------------------------------------

run_step "quickstart script runs and its claims hold (node packages/sdk/quickstart.mjs)" \
    sdk_run node packages/sdk/quickstart.mjs

# ---------------------------------------------------------------------------------------
# Documentation consistency. Most of this project's claims live in prose, and prose rots:
# a file gets renamed, a test count is quoted after the suite grew, a claim that was found
# to be false comes back. This checks the links (markdown AND html, since the markdown pass
# cannot see `href`), that the evidence logs are readable UTF-8, that every quoted test count
# is a count the suites actually produce, that no retired claim has survived, that no markdown
# table row has drifted away from its table, that every test the security model cites in a
# `Guarded by:` line actually exists, and that the website's test counts and deploy slots are
# the ones EVIDENCE.md records.
# ---------------------------------------------------------------------------------------

run_step "documentation consistent (node scripts/check-docs.mjs)" \
    sdk_run node scripts/check-docs.mjs

# ---------------------------------------------------------------------------------------
# Encoding. A file that is not valid UTF-8 is unreadable on Linux and binary to git; a
# mojibake file is valid UTF-8 describing garbage, which no encoding validator alone sees.
# This caught a real defect — three truncated em-dashes in scripts/check-docs.mjs.
# ---------------------------------------------------------------------------------------

run_step "text files are valid UTF-8 (node scripts/check-encoding.mjs)" \
    sdk_run node scripts/check-encoding.mjs

# ---------------------------------------------------------------------------------------
# Summary and true exit code.
# ---------------------------------------------------------------------------------------

finish
