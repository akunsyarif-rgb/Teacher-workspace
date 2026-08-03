# Technical Debt Register

## TD-001: Soft Delete Architecture

**Status:** Deferred

**Reason:** Belum ada kebutuhan bisnis. Saat ini masih satu pengguna dan data uji.

**Estimated Impact:** High

**Affected Modules:**
- Student
- Attendance
- Journal
- Score
- Schedule
- Report

**Trigger:** Aktif ketika aplikasi memiliki pengguna eksternal pertama.

**Plan:** Satu sprint khusus (Sprint X) sebelum public release untuk:
1. Tambah field `deletedAt` / `isDeleted`
2. Ubah Repository (filter aktif)
3. Ubah Service (restore)
4. Tambah Recycle Bin UI
5. Audit Log
