import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";
import ToolCard from "../components/ToolCard";

const PAGE_SIZE = 100;

function HeartIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 20s-7-4.4-9.5-8.8C.7 8 2 4.5 5.5 4a5 5 0 0 1 6.5 2 5 5 0 0 1 6.5-2c3.5.5 4.8 4 3 7.2C19 15.6 12 20 12 20z" />
    </svg>
  );
}

export default function Favorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select("id, tool_id, tool:tools(id, name, status, monetize, price, price_duration_unit, for_sale, photos, profiles(display_name))")
        .eq("profile_id", user.id)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (!mounted) return;
      if (error) setError(error.message);
      else setFavorites(data ?? []);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user.id]);

  async function removeFavorite(favoriteId, toolId) {
    setRemovingId(favoriteId);
    setError("");
    const { error } = await supabase.from("favorites").delete().eq("id", favoriteId);
    setRemovingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    setFavorites((prev) => prev.filter((f) => f.id !== favoriteId));
    await logEvent(user.id, EVENTS.FAVORITE_REMOVED, { tool_id: toolId });
  }

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <BrandBar />
      </div>

      <div className="px-4 py-3.5">
        {loading && <p className="py-8 text-center text-sm text-muted">Loading…</p>}

        {error && <p className="mb-3 rounded-lg bg-[#FCEBEB] p-2.5 text-sm text-signal">{error}</p>}

        {!loading && !error && favorites.length === 0 && (
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
            // A deleted or RLS-hidden tool comes back as a null join.
            if (!tool) return null;
            return (
              <ToolCard
                key={f.id}
                tool={tool}
                action={
                  <button
                    type="button"
                    onClick={() => removeFavorite(f.id, tool.id)}
                    disabled={removingId === f.id}
                    className="flex-shrink-0 text-redOrange disabled:opacity-40"
                    aria-label={`Remove ${tool.name} from favorites`}
                  >
                    <HeartIcon className="h-5 w-5" />
                  </button>
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
