import { useNavigate } from "react-router-dom";
import { useDismissableMenu } from "../lib/useDismissableMenu";

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

/**
 * The owner's per-listing actions on My Tools: edit, pause/resume, delete.
 *
 * Delete is two-step on purpose. It is irreversible and cascades to the
 * tool's favorites and its completed borrow history (0001_init.sql), so a
 * single mis-tap on a small target next to a link should not be able to
 * trigger it.
 *
 * @param {object} props
 * @param {object} props.tool                a tools row, including `paused`
 * @param {boolean} props.busy               an action is in flight for this tool
 * @param {(() => void) | null} [props.onReturn]  present only while the tool is out on loan
 * @param {(paused: boolean) => void} props.onTogglePause
 * @param {() => void} props.onDelete
 * @param {boolean} props.confirmingDelete   show the confirm step
 * @param {(confirming: boolean) => void} props.onConfirmingDeleteChange
 */
export default function ToolManageMenu({
  tool,
  busy = false,
  onReturn = null,
  onTogglePause,
  onDelete,
  confirmingDelete = false,
  onConfirmingDeleteChange,
}) {
  const navigate = useNavigate();
  const { open, setOpen, ref } = useDismissableMenu();

  function close() {
    setOpen(false);
    onConfirmingDeleteChange(false);
  }

  const item = "block w-full px-3 py-2 text-left text-[0.75rem] font-semibold text-asphalt hover:bg-panel/40";

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        aria-label={`Manage ${tool.name}`}
        aria-expanded={open}
        disabled={busy}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted disabled:opacity-40"
      >
        {busy ? <span className="text-[0.688rem] font-bold">…</span> : <DotsIcon />}
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-lg border border-cardBorder bg-white shadow-lg">
          {confirmingDelete ? (
            <div className="p-3">
              <p className="mb-2 text-[0.719rem] leading-snug text-asphalt">
                Delete <b>{tool.name}</b>? This also removes its photos and past borrow history.
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onConfirmingDeleteChange(false);
                    onDelete();
                  }}
                  className="rounded-md bg-signal px-2.5 py-1.5 text-[0.688rem] font-bold text-white"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmingDeleteChange(false)}
                  className="rounded-md border border-steelLight px-2.5 py-1.5 text-[0.688rem] font-bold text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className={item}
                onClick={() => {
                  close();
                  navigate(`/my-tools/${tool.id}/edit`);
                }}
              >
                Edit details
              </button>
              {/* Only for a tool that is actually out. A return is really an
                  event on the borrow request, and lives on the Requests tab
                  too — but this is where an owner notices "on lend until…"
                  and where Delete tells them to resolve it first. */}
              {onReturn && (
                <button
                  type="button"
                  className={item}
                  onClick={() => {
                    close();
                    onReturn();
                  }}
                >
                  Mark returned
                </button>
              )}
              <button
                type="button"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onTogglePause(!tool.paused);
                }}
              >
                {tool.paused ? "Resume listing" : "Pause listing"}
              </button>
              <button
                type="button"
                className={`${item} border-t border-cardBorder text-signal`}
                onClick={() => onConfirmingDeleteChange(true)}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
