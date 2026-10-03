import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "bun";

const root = import.meta.dir;
const outdir = resolve(root, "dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await build({
  entrypoints: [resolve(root, "src/main.tsx"), resolve(root, "src/styles.css")],
  outdir,
  target: "browser",
  format: "esm",
  splitting: true,
  sourcemap: "linked",
  minify: true,
  naming: {
    entry: "[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

await cp(resolve(root, "index.html"), resolve(outdir, "index.html"));
console.log(`JobSniper web built in ${outdir}`);
