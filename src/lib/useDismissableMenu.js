import { useEffect, useRef, useState } from "react";

/**
 * Open/close state for a dropdown/menu that should close on Escape or a
 * click outside it. Shared by BrandBar's nav menu and NotificationBell so
 * both get the same keyboard/outside-click behavior for free, instead of
 * each carrying its own copy.
 */
export function useDismissableMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return { open, setOpen, ref };
}
