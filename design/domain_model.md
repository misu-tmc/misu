# Domain Object Model

The database is the persistence layer for the program objects. SQL tables and rows are
allowed to be normalized for storage, but they are not the object model used by the
application.

Data flows through three shapes:

```text
SQL rows -> repository/adapters -> domain objects -> response projections
```

## Persistence Identity

Objects recovered from, or ready to be saved into, SQL may carry a database record id:

```rust
trait SqlRecord {
    fn id(&self) -> Option<i64>;
    fn set_id(&mut self, id: i64);

    fn should_update(&self) -> bool {
        self.id().is_some()
    }
}
```

For SQL writes, the meaning of `id` is:

- `Some(id)` — issue an `UPDATE` for that SQL record.
- `None` — issue an `INSERT` or `UPSERT`, then set the generated id back on the object.

`should_update` does not mean the object is synchronized with the database. It only means
the object has enough persistence identity to choose an `UPDATE` statement. The object may
still have unsaved in-memory changes.

IDs are persistence metadata. Object relationships should be represented by object fields,
not by SQL foreign-key fields, unless the object intentionally models an external reference.

## Meeting Aggregate

`Meeting` is the aggregate root for meeting info, agenda rows and role takers.

```rust
struct Meeting {
    id: Option<i64>,
    number: i64,
    title: String,
    theme: String,
    keyword: String,
    date: String,
    start_time: String,
    end_time: String,
    venue: String,
    status: String,
    is_template: bool,
    sessions: Vec<Session>,
    role_takers: Vec<RoleTaker>,
}
```

Useful behavior:

```rust
impl Meeting {
    fn phase(&self) -> MeetingPhase;
    fn agenda_sessions(&self) -> &[Session];
    fn prepared_speeches(&self) -> Vec<&RoleTaker>;
}
```

## Session

The storage table is named `session`, but in the program a session is an agenda row.

```rust
struct Session {
    id: Option<i64>,
    position: i64,
    group: String,
    name: String,
    duration_minutes: i64,
    role: Option<RoleTakerRef>,
}
```

`Session` can compute agenda-facing fields from its resolved `RoleTakerRef` without
looking back at the parent `Meeting`:

```rust
impl Session {
    fn agenda_name(&self) -> String;
    fn agenda_taker(&self) -> String;
    fn is_optional(&self) -> bool;
}
```

`agenda_name` uses a prepared speaker title when available; otherwise it falls back to
`name`.

## Role Taker

`RoleTaker` is the concrete per-meeting role slot plus assignment/prep state.

```rust
struct RoleTaker {
    id: Option<i64>,
    role: Role,
    label: String,
    custom_label: Option<String>,
    is_optional: bool,
    booker: Option<User>,
    taker: Option<User>,
    prep_data: PrepData,
    prep_updated_at: Option<String>,
}
```

`Session` stores a `RoleTakerRef`, a compact resolved view of the role taker needed for
agenda behavior and saving the relationship back to SQL.

## Role

```rust
struct Role {
    id: Option<i64>,
    name: String,
    prep_fields: Vec<PrepField>,
}
```

For now, prepared-speech behavior is detected from the role name (`speaker` or
`prepared speech`). If this grows, introduce an explicit `RoleKind` enum.

## Prep Data

Prep data is stored as JSON, but common prepared-speech fields are exposed as typed
accessors.

```rust
struct PrepData {
    raw: serde_json::Value,
}

impl PrepData {
    fn title(&self) -> Option<&str>;
    fn pathway(&self) -> Option<&str>;
    fn level(&self) -> Option<i64>;
    fn purpose(&self) -> Option<&str>;
    fn description(&self) -> Option<&str>;
}
```

## Response Projections

HTTP responses are projections of domain objects. They should be named as response
objects, not treated as the program object model.

Examples:

- `MeetingResponse`
- `SessionResponse`
- `RoleTakerResponse`
- `UserResponse`

These responses may include derived fields, such as `phase`, `agenda_name` and role
labels, because they are read models for the web and mini program surfaces.