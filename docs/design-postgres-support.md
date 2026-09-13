# Postgres Support for sctgdesk-server and sctgdesk-api-server

**Status:** Approved  
**Date:** 2026-09-14  
**Repos:** ~/projects/sctgdesk-server, ~/projects/sctgdesk-api-server

## Goal

Replace the SQLite-only database layer with `sqlx::Any` so both sctgdesk-server (hbbs) and sctgdesk-api-server can run against SQLite or Postgres, selected at runtime via `DATABASE_URL`. SQLite stays the default for backward compatibility and fast local testing. Postgres enables multi-replica deployments.

## Current State

### sctgdesk-server
- sqlx 0.8, `sqlite` feature, `deadpool` pooling
- 1 table (`peer`), 4 `query!()`/`query_as!()` calls, 6 unit tests
- Commented-out `PgPoolOptions` imports — original authors anticipated this

### sctgdesk-api-server
- sqlx 0.8, `sqlite` feature, `SqlitePool`
- 20 tables (all `WITHOUT ROWID`, BLOB primary keys), 46 `query!()`/`query_as!()` calls
- 48 unit tests + 43 integration tests
- Heavy SQLite-specific SQL: `INSERT OR IGNORE` (11), `json_extract()` (2), `last_insert_rowid()` (1), `randomblob()` (1), hex blob literals in seed data

### Shared Database
Both processes read/write the same `db_v2.sqlite3` file. hbbs owns the `peer` table; the api-server owns everything else.

## Design

### 1. Connection Layer

Both repos replace concrete SQLite types with `sqlx::Any`:

| Before | After |
|--------|-------|
| `SqlitePool` | `AnyPool` |
| `SqliteConnection` | `AnyConnection` |
| `deadpool::managed::Pool<DbPool>` (server only) | `AnyPool` |

`Database::new(url: &str)` connects via `AnyPool::connect(url)`. Backend detected from URL scheme (`sqlite://` or `postgres://`). Default: `sqlite://data/db_v2.sqlite3` for backward compat.

sctgdesk-server's `deadpool` wrapper is replaced by sqlx's built-in pooling (AnyPool).

### 2. Cargo.toml Changes

```toml
[dependencies]
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "any", "sqlite", "postgres", "macros", "chrono", "json"] }

[features]
default = []
postgres-tests = []
```

The `any` and `postgres` features are always compiled. `postgres-tests` gates test execution only.

### 3. Schema Management

Two schema files per repo:

```
db_v2/
  create/
    db_sqlite.sql    # current db.sql, unchanged
    db_postgres.sql  # ported: bytea PKs, no WITHOUT ROWID, pg-compatible defaults
  migrations_sqlite/
    *.sql            # current migrations, unchanged
  migrations_postgres/
    *.sql            # ported migrations
```

`Database::new()` detects the backend from the pool and runs the appropriate schema file. Existing `db.sql` is renamed to `db_sqlite.sql` with no changes.

### 4. Query Migration

All `query!()` / `query_as!()` macro calls become runtime `query()` / `query_as::<_, T>()`:

```rust
// Before
sqlx::query_as!(Peer, "SELECT * FROM peer WHERE id = ?", id)

// After
sqlx::query_as::<_, Peer>("SELECT * FROM peer WHERE id = $1")
    .bind(&id)
```

Bind parameters use `$1, $2, ...` — sqlx::Any translates these for both backends.

### 5. SQL Portability

| SQLite | Portable / Postgres | Notes |
|--------|-------------------|-------|
| `INSERT OR IGNORE INTO` | `INSERT INTO ... ON CONFLICT DO NOTHING` | Standard SQL |
| `INSERT OR REPLACE INTO` | `INSERT INTO ... ON CONFLICT(...) DO UPDATE SET ...` | Need explicit conflict target |
| `json_extract(col, '$.key')` | Runtime branch or helper function | SQLite: `json_extract()`, PG: `->>` operator |
| `last_insert_rowid()` | `RETURNING guid` clause | Query returns the inserted ID |
| `WITHOUT ROWID` | Omit in Postgres schema | SQLite optimization, no PG equivalent |
| `blob` columns | `bytea` in Postgres schema | Different type name |
| `randomblob(16)` | `gen_random_bytes(16)` in Postgres seed | Seed data only |
| `X'...'` hex literals | `'\x...'::bytea` in Postgres seed | Seed data only |
| `?` bind params | `$1, $2, ...` | sqlx::Any handles this |
| `sqlite_master` | `information_schema.tables` | Schema introspection |
| Multi-statement `query!()` | Split into separate queries | PG doesn't support multi-statement via sqlx |

For `json_extract()` (2 occurrences), use a helper:

```rust
fn json_field_sql(backend: &str, column: &str, key: &str) -> String {
    match backend {
        "postgres" => format!("{}::json->>'{}'", column, key),
        _ => format!("json_extract({}, '$.{}')", column, key),
    }
}
```

### 6. Row Types

`query_as::<_, T>()` requires `T: FromRow`. Current code uses anonymous record types from `query_as!()` macro. These become explicit structs with `#[derive(sqlx::FromRow)]`:

```rust
#[derive(sqlx::FromRow)]
struct PeerRow {
    guid: Vec<u8>,
    id: String,
    uuid: String,
    // ...
}
```

### 7. Testing

```rust
macro_rules! db_test {
    ($name:ident, |$db:ident| $body:expr) => {
        paste::paste! {
            #[tokio::test]
            async fn [<$name _sqlite>]() {
                let $db = test_db_sqlite().await;
                $body
            }

            #[tokio::test]
            #[cfg_attr(not(feature = "postgres-tests"), ignore)]
            async fn [<$name _postgres>]() {
                let $db = test_db_postgres().await;
                $body
            }
        }
    };
}
```

- `test_db_sqlite()` — in-memory SQLite, runs `db_sqlite.sql`
- `test_db_postgres()` — connects to `TEST_DATABASE_URL`, creates a uniquely-named test database, runs `db_postgres.sql`, drops database on teardown
- `cargo test` — SQLite tests only (fast, no external deps)
- `cargo test --features postgres-tests` — both backends (requires running Postgres)
- Same test body exercises both backends — schema divergence caught immediately

### 8. Phasing

**Phase 1: sctgdesk-server** (small, validates pattern)
1. Add `any`, `postgres` features to Cargo.toml
2. Replace `deadpool` + `SqlitePool` with `AnyPool`
3. Convert 4 `query!()` calls to runtime `query()`
4. Create `db_postgres.sql` (1 table)
5. Add `db_test!` macro, convert 6 tests
6. Verify: `cargo test` passes (SQLite), `cargo test --features postgres-tests` passes (Postgres)

**Phase 2: sctgdesk-api-server** (large, mechanical)
1. Same Cargo.toml changes
2. Replace `SqlitePool` with `AnyPool` in `Database` struct
3. Convert 46 `query!()` calls to runtime `query()`
4. Create `db_postgres.sql` (20 tables)
5. Port 10 migrations to Postgres variants
6. Define `FromRow` structs for all query results
7. Convert 91 tests to `db_test!` macro
8. Verify both backends pass all tests

**Phase 3: Deployment** (future)
- Helm chart: add `DATABASE_URL` env var support for api-server and hbbs
- docker-compose for e2e testing with Postgres

## Out of Scope

- Removing SQLite support — it stays as the default
- Connection string management UI — `DATABASE_URL` env var is sufficient
- Data migration tool (SQLite → Postgres) — separate task
- Multi-replica deployment — enabled by Postgres, but not part of this spec
