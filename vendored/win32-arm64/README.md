# Vendored win32-arm64 native binaries

Native binaries required at runtime that upstream does **not** publish to npm
for Windows ARM64. Built locally from the upstream sources, installed into the
bun store by `scripts/vendor-native-win-arm64.ts` (called from postinstall).

| File | Package | Built from | Why |
|---|---|---|---|
| `tokenizers.win32-arm64-msvc.node` | `@anush008/tokenizers@0.0.0` | github.com/Anush008/tokenizers (rustc, `cargo build --release`) | npm has no `@anush008/tokenizers-win32-arm64-msvc`; napi loader picks up the local file |
| `libsql-win32-arm64-msvc.node` | `libsql@0.5.22` | github.com/tursodatabase/libsql-js @ v0.5.22 | npm has no `@libsql/win32-arm64-msvc`; installed as a stub platform package |

To rebuild: install rustup (MSVC host), clone the repo at the matching tag,
`cargo build --release`, and copy the produced cdylib (`.dll`) here under the
name above.
