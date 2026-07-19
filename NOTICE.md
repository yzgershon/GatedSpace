# Notice

GatedSpace is a modified version of **Superset** (https://github.com/superset-sh/superset),
rebranded and ported to Windows, with a local-only mode that runs without a
cloud backend.

GatedSpace is **not affiliated with, endorsed by, or supported by Superset, Inc.**
"Superset" and the Superset logo are trademarks of Superset, Inc. and are not
used as the mark of this project.

The original software is Copyright © Superset, Inc. and licensed under the
Elastic License 2.0 (ELv2). This modified version is distributed under the same
license — see [LICENSE.md](./LICENSE.md). Per ELv2, this file serves as the
prominent notice that the software has been modified.

Modifications include (non-exhaustive):

- Windows port (x64 and ARM64), including native-module vendoring and packaging
- Local-only mode: the app runs fully offline with no account or cloud services
- Rebranding to GatedSpace (name, artwork, deep-link scheme, update feeds)
- Windows-only CI build and release pipeline

For issues with GatedSpace, use https://github.com/yzgershon/GatedSpace/issues —
do not contact Superset, Inc. about this fork.
