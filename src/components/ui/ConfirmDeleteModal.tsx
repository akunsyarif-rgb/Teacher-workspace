"use client";

import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";

type ConfirmDeleteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
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
  title,
  itemName,
  itemDetail,
  requireTyping = true,
  type = "danger",
}: ConfirmDeleteModalProps) {
  const [loading, setLoading] = useState(false);
  const [typedText, setTypedText] = useState("");
  // Tanpa ini, penghapusan berhasil tapi modal langsung tertutup dan
  // barisnya hilang diam-diam dari daftar — guru tidak sempat sadar
  // aksinya benar-benar berhasil, bukan gagal senyap. Sengaja pakai
  // jeda tampil singkat di sini (bukan toast terpisah) supaya SEMUA
  // 9 pemanggil modal ini otomatis dapat umpan balik yang sama tanpa
  // masing-masing perlu diubah.
  const [success, setSuccess] = useState(false);

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
    try {
      await onConfirm();
      setTypedText("");
      setSuccess(true);
      // Jeda singkat murni supaya "Berhasil dihapus" sempat terbaca sebelum
      // modal menutup diri sendiri — bukan menunggu input guru.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      setSuccess(false);
      onClose();
    } finally {
      setLoading(false);
      setTypedText("");
    }
  }

  function handleClose() {
    setTypedText("");
    setSuccess(false);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={success ? "Berhasil" : title}>
      {success ? (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" aria-hidden />
          <p className="text-sm font-extrabold text-emerald-700">{itemName} berhasil dihapus.</p>
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
