"use client";

import React, { useState } from "react";
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

  const isDanger = type === "danger";
  const bgColor = isDanger ? "bg-red-50" : "bg-amber-50";
  const textColor = isDanger ? "text-red-600" : "text-amber-600";
  const borderColor = isDanger ? "border-red-200" : "border-amber-200";
  const buttonBg = isDanger
    ? "bg-red-600 hover:bg-red-700"
    : "bg-amber-600 hover:bg-amber-700";

  const isConfirmDisabled =
    loading || (requireTyping && typedText !== "HAPUS");

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
      setTypedText("");
    }
  }

  function handleClose() {
    setTypedText("");
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title}>
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
          className={`${buttonBg} text-white`}
        >
          {loading ? "Menghapus..." : "Ya, Hapus"}
        </Button>
      </div>
    </Modal>
  );
}
