import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";

const STATUS_STYLE = {
  available: "bg-[#E9F3E9] text-[#2E6B2E]",
  requested: "bg-[#FCF1D6] text-[#8A6300]",
  borrowed: "bg-[#EEECE8] text-steel",
  unavailable_malfunction: "bg-[#FCEBEB] text-signal",
};

const STATUS_LABEL = {
  available: "Available",
  requested: "Requested",
  borrowed: "Borrowed",
  unavailable_malfunction: "Malfunction",
};

function HeartIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 20s-7-4.4-9.5-8.8C.7 8 2 4.5 5.5 4a5 5 0 0 1 6.5 2 5 5 0 0 1 6.5-2c3.5.5 4.8 4 3 7.2C19 15.6 12 20 12 20z" />
    </svg>
  );
}

export default function Favorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState(null);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("favorites")
      .select(
        "id, tool_id, tool:tools(id, name, status, monetize, price, price_duration_unit, profiles(display_name))"
      )
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (!error) setFavorites(data ?? []);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [user.id]);

  async function removeFavorite(favoriteId) {
    setRemovingId(favoriteId);
    const { error } = await supabase.from("favorites").delete().eq("id", favoriteId);
    setRemovingId(null);
    if (!error) setFavorites((prev) => prev.filter((f) => f.id !== favoriteId));
  }

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <BrandBar />
      </div>

      <div className="px-4 py-3.5">
        {loading && <p className="py-8 text-center text-sm text-muted">Loading…</p>}

        {!loading && favorites.length === 0 && (
          <div className="py-16 text-center text-muted">
            <p className="text-sm">No favorites yet — tap the heart on a tool to save it here.</p>
            <Link to="/" className="mt-2 inline-block text-sm font-semibold text-racing">
              Browse tools
            </Link>
          </div>
        )}

        <div className="space-y-2.5">
          {favorites.map((f) => {
            const tool = f.tool;
            if (!tool) return null;
            return (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-lg border border-cardBorder bg-white p-3"
                style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
              >
                <Link to={`/tool/${tool.id}`} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-asphalt text-safety">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                    <rect x="3" y="9" width="18" height="8" rx="1" />
                    <path d="M7 9V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
                  </svg>
                </Link>
                <Link to={`/tool/${tool.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-bold text-asphalt">{tool.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${STATUS_STYLE[tool.status] ?? ""}`}>
                      {STATUS_LABEL[tool.status] ?? tool.status}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted">{tool.profiles?.display_name ?? "Unknown"}</span>
                  </div>
                </Link>
                <span className={`flex-shrink-0 font-mono text-[12px] font-bold ${tool.monetize ? "text-[#8B6F1F]" : "text-[#3B7A3F]"}`}>
                  {tool.monetize ? `$${tool.price}/${tool.price_duration_unit?.replace("_", " ") ?? "day"}` : "Free"}
                </span>
                <button
                  type="button"
                  onClick={() => removeFavorite(f.id)}
                  disabled={removingId === f.id}
                  className="flex-shrink-0 text-redOrange disabled:opacity-40"
                  aria-label="Remove from favorites"
                >
                  <HeartIcon className="h-5 w-5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
