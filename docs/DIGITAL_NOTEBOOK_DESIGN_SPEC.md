# Teacher Workspace — Digital Notebook Redesign v2.0

Status: implementation scope for PR `design/teacher-workspace-redesign`. This document is the source of truth for the unified redesign. Visual work only; do not alter business logic, data contracts, schema, authorization, grade calculations, attendance rules, or SmadaExam.

## Product direction
Teacher Workspace should feel like a living digital teacher's workbook: warm paper surfaces, readable ink, subtle ruled notes, clear index/navigation, restrained highlighter accents, and efficient classroom workflows. The interface remains intentionally light until a complete dark theme can be designed and tested.

## Scope — one coordinated PR
- Dashboard / Beranda: consistent surfaces and actions; quick note ruled lines must align with text for every line including after repeated Enter, paste, editing and resize; keep autosave and online/offline messaging.
- Class Workspace: all six tabs (Jurnal Mengajar, Presensi, Nilai, Tugas, Pengumuman, Riwayat); shared visual tokens, clear status states, tablet-friendly tab navigation.
- Schedule: week selector, day cards, add/delete schedule flows and modal states.
- Student / class management: class list, student roster, import and management states.
- Shared component patterns: page shell, headers, cards, primary/secondary actions, fields, tabs, tables, badges, save state, empty/loading/error states, confirmation dialogs.
- Adaptive navigation: mobile bottom navigation; tablet layout based on effective width and usable labels; desktop side index only if compatible with existing route/role model. Preserve existing route and role behavior.

## Visual tokens (initial values; contrast must be measured)
| Token | Value | Purpose |
|---|---|---|
| workspace | #F7F5EF | warm page background |
| paper | #FFFEF9 | cards and working surfaces |
| ink | #242923 | primary text |
| ink-muted | #5D665E | secondary text |
| green | #2F6B4F | primary action and active navigation |
| green-strong | #24563F | emphasized text/action |
| highlight | #DDF2A5 | restrained highlight |
| rule | #D9DED5 | borders and notebook rules |
| danger | semantic red | destructive/error states |
| warning | semantic amber | draft/pending states |

Typography targets: page heading 28–32px; section heading 20–22px; body 15–16px; metadata preferably at least 13px. Use a 4px spacing scale, restrained radii/shadows, clear focus indicators and icons plus labels for meaningful statuses. Do not rely on color alone.

## Responsive behavior
- Mobile: bottom navigation stays clear of content; controls are comfortably tappable; no unintended body-level horizontal overflow.
- iPad/tablet portrait and landscape: balanced table density; names and grade-average column remain identifiable while horizontally scrolling; long tab/column labels must remain discoverable rather than silently clipped.
- Desktop: use available space without excessively stretching forms or line lengths.
- Verify Safari iPad, browser zoom, keyboard focus, and narrow viewport.

## Grades and attendance safeguards
- Grades: preserve current calculation semantics, draft/saved distinction, unlock/review/save flow, and validation. Do not change grade data behavior as part of styling.
- Attendance: preserve statuses, autosave queue, retry/error handling, recap/export and completed-session behavior.
- Journal: preserve save/edit/cancel/history behavior and date semantics.
- Schedule/classes: preserve CRUD/import behavior and confirmations.

## Quick Note ruled-line implementation
The textarea line-height and CSS background-size must share the same design token/value. The rule should sit near the text baseline without crossing glyphs. Test consecutive newlines, pasted multi-line text, empty lines, long text, font scaling, textarea height changes, and online/offline autosave status. Do not add a separate line DOM that changes stored note text.

## Acceptance criteria
1. Consistent palette, typography, borders, buttons, cards and focus states across Beranda, Class Workspace, Schedule and Student/Class Management.
2. No low-contrast text or important labels clipped without an alternate way to read them. Measure WCAG 2.2 AA: normal text >= 4.5:1; large text >= 3:1; relevant non-text controls/focus indicators >= 3:1.
3. Quick Note rules align with each text line after repeated Enter, paste, edit and resize; autosave and sync behavior remain intact.
4. Navigation adapts to usable width; active state, labels, keyboard and touch behavior remain clear.
5. Grade calculations, locks, drafts and save review are unchanged; attendance statuses, autosave queue and recap are unchanged.
6. Loading, empty, saved, saving, offline, disabled and error states are understandable and consistent.
7. Build and relevant lint/type checks pass. Run existing automated tests relevant to affected areas. Record actual outcomes; do not claim tests not run.
8. Preview is checked on Safari iPad portrait/landscape and mobile/desktop viewport. No unintended horizontal body overflow or bottom-navigation overlap.
9. One PR only for this redesign. Do not merge or deploy without explicit user approval.

## Required verification
- `npm run build`
- `npm run lint` (record existing unrelated failures separately)
- Relevant existing tests for grade lock, attendance completion/autosave, schedule/class management and e2e smoke where environment allows.
- Manual responsive and accessibility checks listed above.

## Out of scope
Database/schema migrations, authorization/authentication changes, business logic, new features, production data changes, deployment, merging, and any SmadaExam changes.
