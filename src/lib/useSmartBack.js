import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * A Back handler that still works when there is nothing to go back to.
 *
 * Notification emails link straight to a tool, and a mail client opens that in
 * a fresh tab. `navigate(-1)` there has no history entry to pop, so the button
 * looked broken -- it did nothing at all, on the one screen most likely to be
 * somebody's first. React Router marks the first entry of a session with
 * `key === "default"`, which is exactly the case that needs a destination
 * instead of a step backwards.
 *
 * @param {string} [fallback] where to go when this is the first page in the tab
 */
export default function useSmartBack(fallback = "/") {
  const navigate = useNavigate();
  const location = useLocation();
  const isFirstEntry = location.key === "default";

  return useCallback(() => {
    if (isFirstEntry) navigate(fallback, { replace: true });
    else navigate(-1);
  }, [isFirstEntry, navigate, fallback]);
}
