"""Copy the installed app's host database into the org the DEV instance uses.

The dev instance is not signed in to the cloud, so its host service runs under
the LOCAL default org (00000000-0000-4000-8000-000000000002) while the real
workspaces live under the signed-in org (7b2cfe72-...). One host.db per org
directory means dev was reading an empty database sitting right next to a full
one, so every project showed 0 workspaces and /v2-workspace/<id> could not
resolve.

This copies the real host.db into dev's org directory and rewrites the
organization_id columns to match, so the rows are visible to the org dev
actually runs as. It is a deliberate hack for a throwaway UI-only database:
never do this to ~/.superset.

The manifest is NOT touched — dev keeps publishing its own endpoint and PSK.
"""

import glob
import os
import shutil
import sqlite3
import sys

INSTALLED_HOME = os.path.join(os.path.expanduser("~"), ".superset")
# NOT from SUPERSET_HOME_DIR. That variable is often already set to the
# INSTALLED app's home in an ordinary shell, and trusting it here wrote a new
# org directory straight into ~/.superset. The dev home is a fixed path in this
# repo, and the guard below refuses to write anywhere near the real one.
DEV_HOME = r"C:\Dev\superset\superset-dev-data"
DEV_ORG = "00000000-0000-4000-8000-000000000002"


def refuse_if_installed_home(target: str) -> None:
    """Fail closed. This script writes a doctored database; it must never land
    in the home the installed app reads."""
    if os.path.commonpath(
        [os.path.abspath(target), os.path.abspath(INSTALLED_HOME)]
    ) == os.path.abspath(INSTALLED_HOME):
        raise SystemExit(
            "[seed-host-org] REFUSING: target %s is inside the installed app's "
            "home (%s). This script rewrites organization_id and must only ever "
            "touch the throwaway dev home." % (target, INSTALLED_HOME)
        )


def main() -> int:
    sources = glob.glob(os.path.join(INSTALLED_HOME, "host", "*", "host.db"))
    real = [s for s in sources if DEV_ORG not in s]
    if not real:
        print("[seed-host-org] no installed host.db found; nothing to do")
        return 1

    source = real[0]
    target_dir = os.path.join(DEV_HOME, "host", DEV_ORG)
    refuse_if_installed_home(target_dir)
    os.makedirs(target_dir, exist_ok=True)
    target = os.path.join(target_dir, "host.db")

    # Checkpoint the source WAL into a copy so the target is a single
    # self-consistent file. Copying host.db alone would be a stale snapshot.
    tmp = target + ".tmp"
    for suffix in ["", "-wal", "-shm"]:
        if os.path.exists(source + suffix):
            shutil.copy(source + suffix, tmp + suffix)

    conn = sqlite3.connect(tmp)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    remapped = {}
    for (table,) in conn.execute(
        "select name from sqlite_master where type='table'"
    ).fetchall():
        cols = [r[1] for r in conn.execute('PRAGMA table_info("%s")' % table)]
        if "organization_id" not in cols:
            continue
        cur = conn.execute(
            'UPDATE "%s" SET organization_id = ?' % table, (DEV_ORG,)
        )
        if cur.rowcount > 0:
            remapped[table] = cur.rowcount
    conn.commit()

    counts = {}
    for table in ("workspaces", "projects"):
        try:
            counts[table] = conn.execute(
                'select count(*) from "%s"' % table
            ).fetchone()[0]
        except sqlite3.Error:
            pass
    conn.close()

    for suffix in ["", "-wal", "-shm"]:
        if os.path.exists(target + suffix):
            os.remove(target + suffix)
    os.replace(tmp, target)
    for suffix in ["-wal", "-shm"]:
        if os.path.exists(tmp + suffix):
            os.remove(tmp + suffix)

    manifest = os.path.join(target_dir, "manifest.json")
    if os.path.exists(manifest):
        os.remove(manifest)
        print("[seed-host-org] cleared dev manifest (it republishes its own)")

    print("[seed-host-org] from %s" % source)
    print("[seed-host-org] into %s" % target)
    for table, n in sorted(remapped.items()):
        print("   remapped organization_id: %-22s %d row(s)" % (table, n))
    print("[seed-host-org] contents: %s" % counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
