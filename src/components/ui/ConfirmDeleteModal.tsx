"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";

// Semua pemanggil sudah lebih dulu menutup modal sendiri (mis.
// setDeleteTarget(null)) tepat setelah onConfirm() berhasil — wajar
// sebelum ada state sukses di sini, tapi sekarang balapan dengan jeda
// tampil di bawah: prop isOpen dari luar jatuh ke false SEBELUM "berhasil
// dihapus" sempat dirender, jadi modal-nya seolah tidak menampilkan
// apa-apa. Bukannya mengubah 9 pemanggil satu per satu (rapuh, gampang
// lupa lagi di pemanggil berikutnya), visibility modal ini sengaja TIDAK
// murni ikut prop isOpen — lihat showModal di bawah.
const SUCCESS_DISPLAY_MS = 800;

type ConfirmDeleteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  // Sebagian besar pemanggil: onClose dan "apa yang terjadi setelah
  // sukses" itu sama (modal tertutup, tetap di halaman yang sama). Hapus
  // Kelas beda — setelah sukses ia perlu pindah halaman (onBack), tapi
  // saat Batal/X TIDAK boleh ikut pindah. onSuccessClose opsional ini
  // memisahkan dua kasus itu; kalau tidak diisi, jatuh ke onClose.
  onSuccessClose?: () => void;
  title: string;
  itemName: string;
  itemDetail?: string;
  requireTyping?: boolean;
  type?: "danger" | "warning";
};

export default function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  onSuccessClose,
  title,
  itemName,
  itemDetail,
  requireTyping = true,
  type = "danger",
}: ConfirmDeleteModalProps) {
  const [loading, setLoading] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [success, setSuccess] = useState(false);
  // Kebanyakan pemanggil mengosongkan state sumber itemName (mis.
  // setDeleteTarget(null)) begitu onConfirm() beres — begitu itu terjadi,
  // prop itemName ikut jadi "" di render berikutnya. Ditangkap di sini
  // SEBELUM onConfirm() dipanggil supaya pesan sukses tetap menyebut nama
  // itemnya, bukan string kosong.
  const [successItemName, setSuccessItemName] = useState("");

  // Setiap kali parent membuka modal untuk aksi BARU, buang sisa state
  // sukses/ketikan dari aksi sebelumnya — tanpa ini, hapus dua item
  // berturut-turut bisa sempat menampilkan pesan sukses item yang lama.
  useEffect(() => {
    if (isOpen) {
      setSuccess(false);
      setTypedText("");
    }
  }, [isOpen]);

  // Modal tetap tampil selama fase sukses BERJALAN, walau parent sudah
  // menjatuhkan isOpen ke false lewat state-nya sendiri — itulah inti
  // perbaikannya (lihat komentar SUCCESS_DISPLAY_MS di atas).
  const showModal = isOpen || success;

  const isDanger = type === "danger";
  const bgColor = isDanger ? "bg-red-50" : "bg-amber-50";
  const textColor = isDanger ? "text-red-600" : "text-amber-600";
  const borderColor = isDanger ? "border-red-200" : "border-amber-200";
  const buttonBg = isDanger
    ? "bg-red-600 hover:bg-red-700"
    : "bg-amber-600 hover:bg-amber-700";

  const isConfirmDisabled =
    loading || (requireTyping && typedText.trim().toUpperCase() !== "HAPUS");

  async function handleConfirm() {
    setLoading(true);
    const capturedItemName = itemName;
    try {
      await onConfirm();
    } finally {
      // "loading" murni menandai permintaan aktif — begitu onConfirm()
      // selesai (berhasil atau tidak), permintaannya sudah selesai. Fase
      // sukses di bawah ini bukan lagi loading, jadi tidak ikut ditahan
      // sampai jeda tampilnya habis.
      setLoading(false);
      setTypedText("");
    }
    // onConfirm() tidak throw → berhasil. Kalau throw, baris di bawah ini
    // tidak pernah tercapai (exception lewat dari sini, modal tetap
    // terbuka di layar konfirmasi untuk guru coba lagi).
    setSuccessItemName(capturedItemName);
    setSuccess(true);
    await new Promise((resolve) => setTimeout(resolve, SUCCESS_DISPLAY_MS));
    setSuccess(false);
    (onSuccessClose ?? onClose)();
  }

  function handleClose() {
    setTypedText("");
    setSuccess(false);
    onClose();
  }

  return (
    <Modal isOpen={showModal} onClose={handleClose} title={success ? "Berhasil" : title}>
      {success ? (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" aria-hidden />
          <p className="text-sm font-extrabold text-emerald-700">{successItemName} berhasil dihapus.</p>
        </div>
      ) : (
        <>
          <div className={`p-4 rounded-2xl ${bgColor} border ${borderColor} space-y-2`}>
            <p className={`text-sm font-extrabold ${textColor}`}>
              Anda akan menghapus:
            </p>
            <p className="text-base font-black text-gray-900">{itemName}</p>
            {itemDetail && (
              <p className="text-xs font-medium text-gray-500">{itemDetail}</p>
            )}
          </div>

          <p className="text-xs text-gray-500 mt-2">
            Data yang dihapus <span className="font-bold text-red-500">tidak dapat dikembalikan</span>.
          </p>

          {requireTyping && (
            <div className="mt-3">
              <Input
                label={`Ketik "HAPUS" untuk melanjutkan`}
                value={typedText}
                onChange={setTypedText}
                placeholder="Ketik HAPUS"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              loading={loading}
              disabled={isConfirmDisabled}
              className={buttonBg + " text-white"}
            >
              {loading ? "Menghapus..." : "Ya, Hapus"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
