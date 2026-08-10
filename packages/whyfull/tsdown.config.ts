import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node18",
  // No sourcemaps in the published package — they're dev-only debugging aids
  // and were ~45 kB of the tarball. dts.sourcemap:false also drops .d.mts.map.
  dts: { sourcemap: false },
  clean: true,
  splitting: true,
  sourcemap: false,
})
