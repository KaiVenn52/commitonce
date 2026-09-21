// Build @commitonce/solana for both module systems without a bundler.
//
// Two `tsc` passes emit dist/esm and dist/cjs; a per-directory package.json marks the
// module format of each so Node resolves them correctly. Keeping this dependency-free
// means the published artifact is exactly what `tsc` produced from the source in the
// repository, which is easier to audit than a bundled output.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(pkgRoot, "dist");

rmSync(dist, { recursive: true, force: true });

const run = (tsconfig) => {
  execFileSync("npx", ["tsc", "-p", tsconfig], {
    cwd: pkgRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
};

run("tsconfig.esm.json");
run("tsconfig.cjs.json");

mkdirSync(join(dist, "esm"), { recursive: true });
mkdirSync(join(dist, "cjs"), { recursive: true });
writeFileSync(
  join(dist, "esm", "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
);
writeFileSync(
  join(dist, "cjs", "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);

console.log("built dist/esm, dist/cjs, dist/types");
