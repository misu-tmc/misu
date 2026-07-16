# Timer's tool

This utility helps the Timer record time consumed for each agenda session during a
meeting. In the first stage it is a **mode inside the Meeting tab**, not a separate tab or
full-screen page.

## Meeting Tab Timer Mode

Timer mode is activated from the Meeting title card. When active, the **Timer mode**
button becomes **Timer on**, and every agenda row gets timer controls on the right.

```
┌─────────────────────────────────────┐
│ #142 · Sat Jul 12 · 19:00–21:00      │
│ Embrace Change · Room A              │
│ [ Check in ] [ Vote ] [ Timer mode ] │
├─────────────────────────────────────┤
│ Agenda                               │
│ 19:00  Opening / TMOD     6'  Alice  │ [▶] [+]
│ 19:07  Speech 1           7'  Bob    │ [▶] [+]
│       Speech 1 - Stage 1  0'         │ [▶]
│ 19:15  Evaluation 1       3'  Carol  │ [▶] [+]
└─────────────────────────────────────┘
```

### Row controls

- **Play** (`▶`) starts timing that row. Only one row can run at a time.
- While running, the row's button becomes **Pause** (`Ⅱ`) and a **Restart** button (`↺`)
  appears to its left.
- **Pause** keeps the elapsed time but stops counting.
- **Restart** resets elapsed time for the running row to `00:00` and keeps it running.
- **Add sub-session** (`+`) appears only on normal agenda rows. It inserts a sub-session
	immediately below the row and the sub-session has its own Play/Pause/Restart controls.
- Sub-sessions do **not** have their own `+` button.

### First-stage behavior

- Timing state is local to the page and not persisted yet.
- Sub-sessions are local, named from the parent row with a stage number (e.g.
	`Speech 1 - Stage 1`).
- The UI displays elapsed time (`mm:ss`) under the session duration/taker line while timer
	mode is active.
- Later backend persistence can store elapsed time, timer warnings and sub-session notes.

### Later improvements

- Color warnings based on green/yellow/red timing thresholds.
- Bell/beep notification when time exceeds the red threshold.
- Optional full-screen timer focus view.
- Export timer records into meeting minutes or post-meeting reports.