import argparse
from contextlib import closing
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile


def import_data(source, target):
    source = Path(source).resolve(strict=True)
    target = Path(target).absolute()
    if not source.is_dir() or not (source / "monocode.db").is_file():
        raise ValueError("Source must be a MonoCode app data directory containing monocode.db")
    if target.exists() or target.is_symlink():
        raise ValueError("Destination already exists; refusing to overwrite LuxeCode data")
    if source == target.resolve() or source in target.resolve().parents:
        raise ValueError("Destination must be outside the MonoCode data directory")
    if any(path.is_symlink() for path in source.rglob("*")):
        raise ValueError("Source contains symlinks; refusing a potentially shared-data import")
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".luxecode-import-", dir=target.parent))
    try:
        shutil.copytree(source, staging, dirs_exist_ok=True, ignore=shutil.ignore_patterns("monocode.db", "monocode.db-wal", "monocode.db-shm"))
        with closing(sqlite3.connect((source / "monocode.db").as_uri() + "?mode=ro", uri=True)) as original:
            with closing(sqlite3.connect(staging / "monocode.db")) as copied:
                original.backup(copied)
                if copied.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                    raise ValueError("Imported database failed integrity_check")
        for directory, folders, files in os.walk(staging):
            os.chmod(directory, 0o700)
            for filename in files:
                os.chmod(Path(directory) / filename, 0o600)
        os.mkdir(target, 0o700)
        for child in staging.iterdir():
            child.rename(target / child.name)
    finally:
        shutil.rmtree(staging)


def self_test():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        source = root / "com.monocode.desktop"
        source.mkdir()
        with closing(sqlite3.connect(source / "monocode.db")) as database:
            database.execute("PRAGMA journal_mode=WAL")
            database.execute("CREATE TABLE sessions (id TEXT)")
            database.execute("INSERT INTO sessions VALUES ('preserved')")
            database.commit()
            (source / "notes").mkdir()
            (source / "notes" / "draft.md").write_text("draft")
            target = root / "com.luxecode.desktop"
            import_data(source, target)
            with closing(sqlite3.connect(target / "monocode.db")) as copied:
                assert copied.execute("SELECT id FROM sessions").fetchall() == [("preserved",)]
            assert (target / "notes" / "draft.md").read_text() == "draft"
            assert (source / "notes" / "draft.md").read_text() == "draft"
            assert (target / "monocode.db").stat().st_mode & 0o777 == 0o600
            for destination in [target, source / "nested"]:
                try:
                    import_data(source, destination)
                except ValueError:
                    pass
                else:
                    raise AssertionError("Unsafe destination was accepted")
            (source / "shared").symlink_to(source / "notes", target_is_directory=True)
            try:
                import_data(source, root / "unsafe")
            except ValueError:
                pass
            else:
                raise AssertionError("Shared symlink was accepted")
    print("Import checks passed: WAL backup, private copy, no overwrite, no shared symlinks")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Opt-in MonoCode data import; quit both apps first")
    parser.add_argument("source", nargs="?")
    parser.add_argument("target", nargs="?")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test:
        self_test()
    elif arguments.source and arguments.target:
        try:
            import_data(arguments.source, arguments.target)
        except (OSError, ValueError, sqlite3.Error) as error:
            parser.exit(1, f"Import failed: {error}\n")
        print("Imported independent data copy; original MonoCode data remains unchanged")
    else:
        parser.error("Provide source and target, or --self-test")
