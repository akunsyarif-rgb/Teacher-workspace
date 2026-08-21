/**
 * Membatasi berapa lama sebuah promise boleh menggantung.
 *
 * Ada karena jaringan sekolah/seluler bisa putus di tengah jalan TANPA
 * memberi sinyal apa pun ke browser: promise-nya tidak pernah resolve
 * maupun reject, sehingga tombol kirim berputar selamanya dan pengguna
 * tidak pernah tahu apa yang terjadi. Baik uploadBytes() (Storage) maupun
 * batch.commit() (Firestore) sama-sama tidak punya batas waktu bawaan.
 */
export function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Ditandai supaya lapisan UI menampilkan pesannya apa adanya, bukan
      // menggantinya dengan pesan gagal generik (lihat describeSubmissionError).
      reject(Object.assign(new Error(message), { userFacing: true, code: 'app/timeout' }));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
