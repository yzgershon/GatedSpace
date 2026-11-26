# Desktop installer size and build performance

Measured November 26, 2026. Release 1.18.68 finished before this work began.
Its personal installer and both published public installers remain unchanged.
These packaging changes are committed for the next release; no new installer
or version was produced for this benchmark.

## Measured local results

The control uses application commit `716c3ce7c`. The optimized run uses packaging
commit `4130c0c0b` with the same compiled application and native dependencies.
Both runs use the native Windows path wrapper, ARM64 Electron 40.8.5, and the
standard `apps/desktop/release` output directory.

| Measurement | Control | Optimized | Change |
| --- | ---: | ---: | ---: |
| Unpacked application | 1,531,121,952 bytes | 1,381,237,688 bytes | 149.9 MB smaller, 9.8% |
| Compressed application payload | 397,136,436 bytes | 359,702,971 bytes | 37.4 MB smaller, 9.4% |
| Unpacked packaging step | 176.0 seconds | 112.0 seconds | 36.4% faster |
| Payload compression | 43.9 seconds | 47.0 seconds | No measured improvement |
| Files inside ASAR | 66,637 | 59,979 | 6,658 removed |

MB uses decimal bytes. The compressed payload uses the existing NSIS compression
settings: level 9, 1 MB dictionary, non-solid 7z. It excludes the NSIS executable
wrapper and blockmap, so it is not a measurement of a newly built installer.
`--dir` omits `elevate.exe` and `app-update.yml`; their original, unchanged bytes
were restored from the control payload before comparing sizes and compression.
Each timing is one sequential local run, not a guaranteed release duration.

Level 5 was also tested on the control. It took 46.5 seconds and produced
399,851,938 bytes, so lowering compression was rejected.

All 59,979 retained ASAR files are byte-identical. All 1,498 retained physical
files other than the application executable are byte-identical. The executable's
only changed PE section is `.rsrc`, where electron-builder updates ASAR integrity
metadata; its executable code sections are unchanged. There were no unexpected
added or removed files. SQLite queries, keyboard mapping, libsql, the file watcher,
and DuckDB loaded under the packaged Electron runtime. The bundled CLI reports
1.18.68. The packaging hook verified the offline dictation bundle and architecture.

Local evidence is in `.tmp/installer-optimization/`: `package-comparison.json`,
`control-pack.json`, `optimized-pack.json`, `compression.json`,
`optimized-compression.json`, `executable-check.json`, and
`packaged-native-check.json`. Temporary benchmark archives can be deleted after
recording these receipts; they are not release artifacts.

## What no longer ships twice

- The CLI, Git, database migrations, and offline dictation belong outside ASAR at
  `resources/resources`. The `dist` FileSet excludes their extra copies.
- Vite's public assets already exist under `dist/renderer`. Source copies and
  installer artwork are omitted; application and tray icons remain.
- Type declarations, build caches, SQLite compilation inputs, and graph-library
  demos are omitted. Runtime JavaScript, native binaries, loaders, and licenses
  remain. No agent, browser, terminal, or offline voice feature was removed.
- Public `prepackage` now strips debug maps **after** native validation and any
  compilation-time error-reporting upload. It previously missed the physical
  stripping step that personal builds already used.

The published ARM64 1.18.68 archive contains 96,923,648 bytes of duplicate CLI,
90,171,565 bytes of duplicate Git, a 37,936,336-byte Git download archive, and
118,321,456 bytes of debug maps. Those four categories total 343.4 MB before
compression. Their removal is configured for public builds, but a new public
installer's final compressed size has not yet been measured.

`verifyPackagedResourceLayout` checks the actual archive after packaging. It rejects
duplicate external tools or debug maps, requires application entry points, and
requires the canonical CLI, migrations, voice resources, and bundled Git when
present in the source build. Tests exercise electron-builder's own matcher and
real ASAR fixtures rather than relying on an approximate glob implementation.

## Build pipeline changes

The completed personal build took 9m00.6s, including compilation, six UI suites,
packaging, verification, and completion reporting. The completed public workflow
took 29m35s. Its ARM64 job spent 6m36s installing dependencies, 7m21s preparing
native modules, 4m13s compiling, 6m24s packaging, and 2m59s uploading its cache.

Public release tags could not restore the previous release tag's cache. GitHub
allows tags to restore default-branch caches, while sibling tags are isolated.
See [GitHub's cache scope documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

The new workflow therefore:

1. Warms Bun downloads, native build outputs/headers, and verified offline voice
   bundles on trusted pushes to `main` or a manual run on `main`.
2. Uses content-based cache keys. Release version increments do not discard the
   dependency cache. Dependency, integrity, Bun, native-source, and voice-source
   changes invalidate the corresponding keys. Architectures are separate.
3. Uses the same pinned `@electron/rebuild` implementation as electron-builder,
   enabling its module-content/ABI/architecture cache. Cache misses still rebuild.
4. Restores caches without uploading another tag-only copy on the release path.
5. Uses the existing fast Windows path wrapper for public packaging too, avoids
   the redundant native rebuild after validation, and disables ZIP recompression
   for already-compressed installer artifacts.

An isolated native-keymap cache restoration took 98 ms, returned identical binary
bytes, and loaded successfully under Electron ABI 143. Different architectures
and ABIs produced different keys. The new native preparation helper also passed
against the existing complete dependency tree in 1.1 seconds; that run reused
already-prepared modules and is not a cold-build timing.

The first run of the new workflow may still populate empty caches. A complete
optimized x64/ARM64 release has not run yet, so an end-to-end CI speedup or an
under-ten-minute release is not claimed. Native validation, clean-startup tests,
installer/blockmap verification, and public download checks remain required.

## Checks before the next release

```powershell
bun test apps/desktop/packaging-layout.test.ts apps/desktop/runtime-dependencies.test.ts scripts/release/desktop-build-cache.test.ts scripts/release/build-checkpoints.test.ts
node --test scripts/release/windows-packager.test.cjs
bun node_modules/typescript/bin/tsc --project scripts/release/tsconfig.json
```

The changed packaging TypeScript also passed a targeted type check. Both workflows
passed actionlint 1.7.12. Keep the usual isolated committed snapshot and per-release
receipts, and compare the next actual personal/public installer sizes and workflow
phase timings with this baseline.
