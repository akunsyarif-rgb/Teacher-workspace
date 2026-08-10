## Project Architecture (Teacher-workspace)

### Layer Flow
Presentation (page.tsx/components) → Controller → Service → Repository → Adapter → Firestore
- UI tidak boleh panggil Firestore langsung — selalu lewat Controller
- Repository = satu-satunya layer yang boleh sentuh Firestore, lewat Adapter (bukan langsung), supaya migrasi database nanti tidak perlu rewrite Service/Repository

### Multi-tenancy (Workspace Scoping)
- Setiap collection (students, journals, attendances, grades, schedules) WAJIB punya field `workspaceId`
- Semua query di Repository WAJIB difilter by `workspaceId` dari WorkspaceContext — tidak ada exception
- WorkspaceContext hanya session state (workspaceId, role, plan, teacherProfile) — TIDAK boleh ada Firestore query atau business logic di dalamnya

### Security
- Jangan pernah percaya data dari client — semua permission dicek ulang di server (Security Rules)
- Field `workspaceId`, `createdBy`, `createdAt` tidak boleh diubah setelah dokumen dibuat (immutable)
- `createdAt`/`updatedAt` harus dari `serverTimestamp()`, bukan `new Date()` di client

### Naming & Style
- Komponen: PascalCase (contoh: `ClassManagement.tsx`)
- Fungsi: camelCase, deskriptif (contoh: `fetchStudentsInClass`, bukan `getData`)

### Breaking Changes
- Perubahan tidak boleh merusak fitur yang sudah ada, kecuali sudah disetujui eksplisit sebelumnya

### Do Not
- Jangan bikin fitur di luar scope (LMS, video conferencing, ERP sekolah)
- Jangan query full sheet/collection history kalau cuma butuh data periode tertentu (contoh: Beranda cukup ambil data hari ini)
