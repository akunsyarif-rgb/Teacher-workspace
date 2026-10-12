// Antrean autosave jawaban ulangan (sisi klien). Satu-satunya sumber kebenaran "jawaban mana yang SUDAH dikonfirmasi server".
//  - Hanya satu pengurasan (drain) berjalan pada satu waktu; pemanggil flush() kedua MENUNGGU drain yang sedang berjalan,
//    bukan dianggap selesai — supaya submit tidak mendahului jawaban yang masih di perjalanan.
//  - Jawaban yang diganti saat request lama masih berjalan tetap di antrean: respons lama hanya menghapus entri bila nilainya
//    masih sama dengan yang dikirim. Drain mengulang sampai antrean kosong (termasuk perubahan yang masuk di tengah jalan).
//  - Gagal jaringan/server: antrean dipertahankan (dicoba lagi oleh pemanggil); tidak pernah dianggap tersimpan.
//  - Pengerjaan sudah ditutup server (attempt_expired / attempt_not_active): drain berhenti, hasil `closed`.

export type SaveAnswer = (questionId: string, optionId: string) => Promise<unknown>;
export type FlushResult = { ok: true } | { ok: false; closed: boolean; error: unknown };

const CLOSED = /attempt_expired|attempt_not_active/;

export function createAnswerQueue(save: SaveAnswer, onChange: () => void = () => {}) {
  const pending = new Map<string, string>();
  let running: Promise<FlushResult> | null = null;
  let failed = false;

  async function drain(): Promise<FlushResult> {
    // Batas putaran hanya pengaman terhadap loop tak berujung bila siswa terus mengganti jawaban selama drain.
    for (let round = 0; pending.size > 0 && round < 50; round++) {
      for (const [qid, oid] of [...pending]) {
        try {
          await save(qid, oid);
        } catch (error) {
          const closed = CLOSED.test(error instanceof Error ? error.message : String(error));
          failed = !closed;
          onChange();
          return { ok: false, closed, error };
        }
        if (pending.get(qid) === oid) pending.delete(qid);
        failed = false;
        onChange();
      }
    }
    return pending.size === 0 ? { ok: true } : { ok: false, closed: false, error: new Error('pending_remaining') };
  }

  return {
    /** Catat pilihan terbaru untuk soal ini (menimpa pilihan lama yang belum terkirim). */
    set(questionId: string, optionId: string) {
      pending.set(questionId, optionId);
      onChange();
    },
    /** Kirim semua yang tertunda. Bila drain sudah berjalan, menunggu drain itu lalu menguras sisa perubahan baru. */
    async flush(): Promise<FlushResult> {
      while (running) {
        const r = await running;
        if (!r.ok || pending.size === 0) return r;
      }
      if (pending.size === 0) return { ok: true };
      running = drain().finally(() => { running = null; });
      return running;
    },
    size: () => pending.size,
    ids: () => [...pending.keys()],
    entries: () => [...pending],
    failed: () => failed,
    clear() {
      pending.clear();
      failed = false;
      onChange();
    },
  };
}

export type AnswerQueue = ReturnType<typeof createAnswerQueue>;
