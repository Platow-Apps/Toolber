import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

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

export default function MyTools() {
  const { user } = useAuth();
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("tools")
      .select("id, name, status, monetize, price, price_duration_unit")
      .eq("crib_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (!error) setTools(data ?? []);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [user.id]);

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <p className="font-condensed text-xl font-bold uppercase tracking-wide text-safety">My Tools</p>
      </div>

      <div className="px-4 py-3.5">
        <Link
          to="/my-tools/new"
          className="mb-3.5 flex w-full items-center justify-center gap-2 rounded-lg bg-asphalt py-3 font-condensed text-[13px] font-bold uppercase tracking-wide text-safety"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          List a tool
        </Link>

        {loading && <p className="py-8 text-center text-sm text-muted">Loading…</p>}

        {!loading && tools.length === 0 && (
          <p className="py-12 text-center text-sm text-muted">Nothing listed yet — add your first tool above.</p>
        )}

        <div className="space-y-2.5">
          {tools.map((tool) => (
            <Link
              key={tool.id}
              to={`/tool/${tool.id}`}
              className="flex items-center gap-3 rounded-lg border border-cardBorder bg-white p-3"
              style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
            >
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-asphalt text-safety">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <rect x="3" y="9" width="18" height="8" rx="1" />
                  <path d="M7 9V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold text-asphalt">{tool.name}</p>
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${STATUS_STYLE[tool.status] ?? ""}`}>
                  {STATUS_LABEL[tool.status] ?? tool.status}
                </span>
              </div>
              <span className={`flex-shrink-0 font-mono text-[12px] font-bold ${tool.monetize ? "text-[#B5602A]" : "text-[#3B7A3F]"}`}>
                {tool.monetize ? `$${tool.price}/${tool.price_duration_unit?.replace("_", " ") ?? "day"}` : "Free"}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
