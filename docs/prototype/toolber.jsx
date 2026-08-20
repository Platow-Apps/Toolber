import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Wrench, Search, MapPin, Lock, Unlock, Plus, X, Check, Clock,
  Users, ShieldCheck, DollarSign, Image as ImageIcon, Send, Copy,
  MessageCircle, Facebook, Rss, Home, ChevronRight, Hammer, Drill,
  Scissors, Construction, Paintbrush, Zap, Gauge, Shovel, TreePine, Settings2,
  Bell, ArrowLeft, Loader2, CircleCheck
} from "lucide-react";

/* ---------------------------------------------------------
   TOOLBER — neighborhood tool-lending library
   Design language: workshop pegboard + hardware-store signage
   + old-fashioned library checkout cards.
--------------------------------------------------------- */

const FONT_LINK_ID = "toolber-fonts";
function useFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
}

const TOOLBER_FEE_PCT = 10;

const CATEGORY_ICONS = {
  Power: Drill,
  Hand: Hammer,
  Yard: TreePine,
  Ladder: Construction,
  Paint: Paintbrush,
  Garden: Shovel,
  Electrical: Zap,
  Measure: Gauge,
  Cutting: Scissors,
};

const GROUPS = [
  {
    id: "oakhill",
    name: "Oak Hill Tool Library",
    neighborhood: "Oak Hill",
    code: "OAKHILL482",
    memberOf: true,
    admin: "Priya S.",
  },
  {
    id: "riverside",
    name: "Riverside Loop Co-op",
    neighborhood: "Riverside Loop",
    code: "RVLOOP219",
    memberOf: false,
    admin: "Marcus T.",
  },
];

const SEED_TOOLS = [
  {
    id: "t1",
    name: "18V Cordless Drill",
    category: "Power",
    description:
      "DeWalt 18V drill/driver with two batteries and a charger. Great for furniture assembly and small deck jobs.",
    owner: "Jordan K.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "142 Birchwood Ct",
    status: "available",
    monetize: true,
    price: 6,
    color: "#F2B705",
  },
  {
    id: "t2",
    name: "Extendable Ladder (24ft)",
    category: "Ladder",
    description:
      "Aluminum extension ladder, reaches second-story gutters. Heavy — best with two people carrying it.",
    owner: "Priya S.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "88 Sycamore Ave",
    status: "borrowed",
    monetize: false,
    price: 0,
    color: "#4C6444",
  },
  {
    id: "t3",
    name: "Wet Tile Saw",
    category: "Cutting",
    description:
      "7-inch wet saw for tile and stone cuts. I'll walk you through blade setup the first time you borrow it.",
    owner: "Dee R.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "21 Foundry Ln",
    status: "available",
    monetize: true,
    price: 12,
    color: "#B5502D",
  },
  {
    id: "t4",
    name: "Rotary Lawn Aerator",
    category: "Yard",
    description: "Push-behind core aerator. Best used in early spring or fall before overseeding.",
    owner: "Priya S.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "88 Sycamore Ave",
    status: "requested",
    monetize: false,
    price: 0,
    color: "#4C6444",
  },
  {
    id: "t5",
    name: "Framing Hammer Set (3pc)",
    category: "Hand",
    description: "Two 16oz and one 20oz framing hammers. Good grip, low bounce-back.",
    owner: "Jordan K.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "142 Birchwood Ct",
    status: "available",
    monetize: false,
    price: 0,
    color: "#F2B705",
  },
  {
    id: "t6",
    name: "HVLP Paint Sprayer",
    category: "Paint",
    description: "Great for fences and cabinets. Comes with two extra nozzle tips and cleaning brush.",
    owner: "Dee R.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "21 Foundry Ln",
    status: "available",
    monetize: true,
    price: 9,
    color: "#B5502D",
  },
  {
    id: "t7",
    name: "Rear-Tine Garden Tiller",
    category: "Garden",
    description: "Gas-powered tiller for breaking new ground. Loud but chews through clay soil fast.",
    owner: "Dee R.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "21 Foundry Ln",
    status: "available",
    monetize: true,
    price: 8,
    color: "#B5502D",
  },
  {
    id: "t8",
    name: "Digital Multimeter & Fish Tape Kit",
    category: "Electrical",
    description: "Auto-ranging multimeter plus 25ft fish tape for pulling wire through walls.",
    owner: "Jordan K.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "142 Birchwood Ct",
    status: "available",
    monetize: false,
    price: 0,
    color: "#F2B705",
  },
  {
    id: "t9",
    name: "Self-Leveling Laser Level",
    category: "Measure",
    description: "Cross-line laser with tripod. Handy for hanging cabinets, shelves, and fence lines dead level.",
    owner: "Priya S.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "88 Sycamore Ave",
    status: "borrowed",
    monetize: true,
    price: 7,
    color: "#4C6444",
  },
  {
    id: "t10",
    name: "18V Impact Driver",
    category: "Power",
    description: "Compact impact driver, pairs with the same 18V batteries as the cordless drill. Great for decking screws.",
    owner: "Dee R.",
    groupId: "oakhill",
    neighborhood: "Oak Hill",
    address: "21 Foundry Ln",
    status: "requested",
    monetize: false,
    price: 0,
    color: "#B5502D",
  },
];

const STATUS_META = {
  available: { label: "AVAILABLE", color: "#4C6444" },
  borrowed: { label: "CHECKED OUT", color: "#B5502D" },
  requested: { label: "REQUESTED", color: "#F2B705" },
};

/* ------------------------- small primitives ------------------------- */

function PegHoles({ count = 2 }) {
  return (
    <div className="flex gap-3 justify-center -mb-1 relative z-10">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#22262B",
            boxShadow: "inset 0 2px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.15)",
          }}
        />
      ))}
    </div>
  );
}

function Stamp({ status }) {
  const meta = STATUS_META[status];
  return (
    <div
      className="absolute top-3 right-3 select-none pointer-events-none"
      style={{
        transform: "rotate(-8deg)",
        border: `2px solid ${meta.color}`,
        color: meta.color,
        padding: "3px 8px",
        borderRadius: 4,
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: "0.08em",
        background: "rgba(251,246,234,0.85)",
        opacity: 0.92,
      }}
    >
      {meta.label}
    </div>
  );
}

function Badge({ children, tone = "graphite" }) {
  const tones = {
    graphite: { bg: "#22262B", fg: "#E7DCC4" },
    yellow: { bg: "#F2B705", fg: "#22262B" },
    moss: { bg: "#4C6444", fg: "#FBF6EA" },
    rust: { bg: "#B5502D", fg: "#FBF6EA" },
  };
  const t = tones[tone];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded"
      style={{ background: t.bg, color: t.fg, fontFamily: "'IBM Plex Mono', monospace" }}
    >
      {children}
    </span>
  );
}

function Toast({ toasts }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="px-4 py-3 rounded-md shadow-lg flex items-center gap-2 text-sm max-w-xs animate-[fadein_0.2s_ease]"
          style={{ background: "#22262B", color: "#FBF6EA", fontFamily: "'IBM Plex Sans', sans-serif" }}
        >
          <CircleCheck size={16} style={{ color: "#F2B705", flexShrink: 0 }} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Tool Card ------------------------------ */

function ToolCard({ tool, onOpen }) {
  const Icon = CATEGORY_ICONS[tool.category] || Wrench;
  return (
    <button
      onClick={() => onOpen(tool)}
      className="text-left relative group"
      style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
    >
      <PegHoles />
      <div
        className="relative rounded-b-lg rounded-tr-lg overflow-hidden border transition-transform group-hover:-translate-y-0.5"
        style={{
          background: "#FBF6EA",
          borderColor: "#22262B22",
          boxShadow: "0 4px 0 #22262B14, 0 8px 18px -8px rgba(34,38,43,0.35)",
        }}
      >
        <div
          className="h-28 flex items-center justify-center relative"
          style={{ background: `${tool.color}22` }}
        >
          <Icon size={44} strokeWidth={1.5} style={{ color: tool.color }} />
          <Stamp status={tool.status} />
        </div>
        <div className="p-3.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-[15px] leading-snug" style={{ color: "#1B1B1B" }}>
              {tool.name}
            </h3>
          </div>
          <p className="text-[12.5px] mt-1 leading-snug line-clamp-2" style={{ color: "#5b5648" }}>
            {tool.description}
          </p>
          <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: "1px dashed #22262B33" }}>
            <span
              className="text-[11px] inline-flex items-center gap-1"
              style={{ color: "#7a7362", fontFamily: "'IBM Plex Mono', monospace" }}
            >
              <MapPin size={12} /> {tool.neighborhood}
            </span>
            {tool.monetize ? (
              <span className="text-[12px] font-bold" style={{ color: "#B5502D" }}>
                ${tool.price}/day
              </span>
            ) : (
              <Badge tone="moss">Free</Badge>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/* ---------------------------- Tool Detail Modal ---------------------------- */

function ToolModal({ tool, onClose, currentUser, addressState, onRequestAddress, onRequestBorrow }) {
  if (!tool) return null;
  const meta = STATUS_META[tool.status];
  const addrInfo = addressState[tool.id] || { state: "hidden" };
  const isOwner = tool.owner === currentUser;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(20,22,25,0.55)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-xl overflow-hidden"
        style={{ background: "#FBF6EA", fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        <div className="h-36 relative flex items-center justify-center" style={{ background: `${tool.color}22` }}>
          {React.createElement(CATEGORY_ICONS[tool.category] || Wrench, {
            size: 56,
            strokeWidth: 1.4,
            style: { color: tool.color },
          })}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "#22262B", color: "#FBF6EA" }}
          >
            <X size={16} />
          </button>
          <div className="absolute bottom-3 left-3">
            <Badge tone={tool.status === "available" ? "moss" : tool.status === "borrowed" ? "rust" : "yellow"}>
              {meta.label}
            </Badge>
          </div>
        </div>

        <div className="p-5">
          <h2 className="text-2xl leading-none" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", color: "#1B1B1B" }}>
            {tool.name}
          </h2>
          <p className="text-[13px] mt-2 leading-relaxed" style={{ color: "#4a4636" }}>
            {tool.description}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
            <div className="rounded-md p-2.5" style={{ background: "#22262B08" }}>
              <div className="uppercase tracking-wide text-[10px] mb-0.5" style={{ color: "#7a7362", fontFamily: "'IBM Plex Mono', monospace" }}>Owner</div>
              <div className="font-semibold" style={{ color: "#1B1B1B" }}>{tool.owner}</div>
            </div>
            <div className="rounded-md p-2.5" style={{ background: "#22262B08" }}>
              <div className="uppercase tracking-wide text-[10px] mb-0.5" style={{ color: "#7a7362", fontFamily: "'IBM Plex Mono', monospace" }}>Rough location</div>
              <div className="font-semibold" style={{ color: "#1B1B1B" }}>{tool.neighborhood}</div>
            </div>
          </div>

          <div className="mt-3 rounded-md p-3" style={{ background: "#22262B08" }}>
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-wide text-[10px]" style={{ color: "#7a7362", fontFamily: "'IBM Plex Mono', monospace" }}>
                Exact address
              </span>
              {addrInfo.state === "revealed" ? <Unlock size={13} style={{ color: "#4C6444" }} /> : <Lock size={13} style={{ color: "#7a7362" }} />}
            </div>
            {addrInfo.state === "revealed" ? (
              <div className="mt-1 font-semibold text-[14px]" style={{ color: "#1B1B1B" }}>{tool.address}</div>
            ) : addrInfo.state === "pending" ? (
              <div className="mt-1.5 flex items-center gap-2 text-[13px]" style={{ color: "#7a7362" }}>
                <Loader2 size={14} className="animate-spin" /> Waiting on {tool.owner.split(" ")[0]} to approve…
              </div>
            ) : (
              <button
                onClick={() => onRequestAddress(tool.id, tool.owner)}
                className="mt-1.5 text-[13px] font-semibold inline-flex items-center gap-1"
                style={{ color: "#B5502D" }}
              >
                Request exact address <ChevronRight size={13} />
              </button>
            )}
          </div>

          {tool.monetize && (
            <div className="mt-3 flex items-center justify-between text-[12.5px] rounded-md p-3" style={{ background: "#F2B70522", border: "1px solid #F2B70555" }}>
              <span className="font-semibold" style={{ color: "#1B1B1B" }}>${tool.price}/day rental</span>
              <span style={{ color: "#7a7362" }}>Toolber fee {TOOLBER_FEE_PCT}% goes to {tool.owner.split(" ")[0]}'s payout</span>
            </div>
          )}

          <button
            disabled={isOwner || tool.status !== "available"}
            onClick={() => onRequestBorrow(tool)}
            className="mt-4 w-full py-3 rounded-md font-semibold text-[14px] tracking-wide flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: "#22262B", color: "#F2B705", fontFamily: "'IBM Plex Sans', sans-serif" }}
          >
            <Send size={15} />
            {isOwner ? "This is your tool" : tool.status === "available" ? "Request to borrow" : "Currently unavailable"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Add Tool Form ------------------------------ */

function AddToolModal({ open, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Power");
  const [description, setDescription] = useState("");
  const [monetize, setMonetize] = useState(false);
  const [price, setPrice] = useState(5);
  const [imgPreview, setImgPreview] = useState(null);
  const fileRef = useRef();

  if (!open) return null;

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (file) setImgPreview(URL.createObjectURL(file));
  }

  function submit() {
    if (!name.trim() || !description.trim()) return;
    onAdd({
      name: name.trim(),
      category,
      description: description.trim(),
      monetize,
      price: monetize ? Number(price) : 0,
    });
    setName(""); setDescription(""); setMonetize(false); setPrice(5); setImgPreview(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-6" style={{ background: "rgba(20,22,25,0.55)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md rounded-t-2xl sm:rounded-xl p-5 max-h-[90vh] overflow-y-auto" style={{ background: "#FBF6EA", fontFamily: "'IBM Plex Sans', sans-serif" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl leading-none" style={{ fontFamily: "'Bebas Neue', sans-serif", color: "#1B1B1B" }}>List a tool</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#22262B", color: "#FBF6EA" }}><X size={16} /></button>
        </div>

        <label onClick={() => fileRef.current?.click()} className="block h-28 rounded-md mb-3.5 flex items-center justify-center cursor-pointer border-2 border-dashed" style={{ borderColor: "#22262B33", background: imgPreview ? undefined : "#22262B08" }}>
          {imgPreview ? (
            <img src={imgPreview} alt="preview" className="h-full w-full object-cover rounded-md" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-[12px]" style={{ color: "#7a7362" }}>
              <ImageIcon size={20} /> Add a photo
            </span>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </label>

        <div className="space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "#7a7362", fontFamily: "'IBM Plex Mono', monospace" }}>Tool name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Circular saw" className="w-full px-3 py-2.5 rounded-md outline-none text-[14px]" style={{ background: "#22262B0D", border: "1px solid #22262B22" }} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "#7a7362", fontFamily: "'IBM Plex Mono', monospace" }}>Category</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(CATEGORY_ICONS).map((c) => (
                <button key={c} onClick={() => setCategory(c)} className="px-2.5 py-1 rounded text-[12px] font-medium" style={{ background: category === c ? "#22262B" : "#22262B0D", color: category === c ? "#F2B705" : "#4a4636" }}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "#7a7362", fontFamily: "'IBM Plex Mono', monospace" }}>Description — this is what neighbors search</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Condition, what it's good for, anything a borrower should know…" className="w-full px-3 py-2.5 rounded-md outline-none text-[14px] resize-none" style={{ background: "#22262B0D", border: "1px solid #22262B22" }} />
          </div>

          <div className="flex items-center justify-between rounded-md p-3" style={{ background: "#22262B08" }}>
            <div>
              <div className="font-semibold text-[13.5px]" style={{ color: "#1B1B1B" }}>Charge a rental fee?</div>
              <div className="text-[11.5px]" style={{ color: "#7a7362" }}>Toolber keeps {TOOLBER_FEE_PCT}% of paid rentals</div>
            </div>
            <button onClick={() => setMonetize((m) => !m)} className="w-11 h-6 rounded-full relative transition-colors" style={{ background: monetize ? "#4C6444" : "#22262B33" }}>
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: monetize ? 22 : 2 }} />
            </button>
          </div>
          {monetize && (
            <div className="flex items-center gap-2">
              <DollarSign size={16} style={{ color: "#7a7362" }} />
              <input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} className="w-24 px-2 py-1.5 rounded-md text-[14px]" style={{ background: "#22262B0D", border: "1px solid #22262B22" }} />
              <span className="text-[12.5px]" style={{ color: "#7a7362" }}>per day &nbsp;·&nbsp; you'd net ${(price * (1 - TOOLBER_FEE_PCT / 100)).toFixed(2)}/day</span>
            </div>
          )}
        </div>

        <button onClick={submit} className="mt-5 w-full py-3 rounded-md font-semibold text-[14px] flex items-center justify-center gap-2" style={{ background: "#22262B", color: "#F2B705" }}>
          <Plus size={16} /> Add to the pegboard
        </button>
      </div>
    </div>
  );
}

/* -------------------------------- Group Tab -------------------------------- */

function ShareRow({ icon: Icon, label, onClick, color }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 w-full px-3.5 py-3 rounded-md text-left" style={{ background: "#22262B08" }}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: color }}>
        <Icon size={15} color="#fff" />
      </div>
      <span className="text-[13.5px] font-medium flex-1" style={{ color: "#1B1B1B" }}>{label}</span>
      <ChevronRight size={15} style={{ color: "#7a7362" }} />
    </button>
  );
}

function GroupTab({ groups, onJoinRequest, joinRequests, pushToast }) {
  const [active, setActive] = useState(groups[0]);
  const inviteText = `You're invited to join ${active.name} on Toolber 🔧 — borrow and lend tools with neighbors. Use code ${active.code} or tap: https://toolber.app/join/${active.code}`;

  function share(platform) {
    const url = `https://toolber.app/join/${active.code}`;
    const encoded = encodeURIComponent(inviteText);
    const map = {
      text: `sms:?&body=${encoded}`,
      whatsapp: `https://wa.me/?text=${encoded}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      reddit: `https://www.reddit.com/submit?title=${encodeURIComponent(active.name + " — join our tool library")}&url=${encodeURIComponent(url)}`,
    };
    if (map[platform]) window.open(map[platform], "_blank");
  }

  function copyLink() {
    navigator.clipboard?.writeText(inviteText);
    pushToast("Invite text copied — paste it into your Nextdoor post or any group.");
  }

  const myRequest = joinRequests[active.id];

  return (
    <div className="px-4 pb-24 pt-4 max-w-lg mx-auto">
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {groups.map((g) => (
          <button key={g.id} onClick={() => setActive(g)} className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap" style={{ background: active.id === g.id ? "#22262B" : "#22262B0D", color: active.id === g.id ? "#F2B705" : "#4a4636" }}>
            {g.neighborhood}
          </button>
        ))}
      </div>

      <div className="rounded-lg p-4 mb-4" style={{ background: "#22262B", color: "#FBF6EA" }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={16} style={{ color: "#F2B705" }} />
          <span className="text-[11px] uppercase tracking-wider" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#F2B705" }}>Borrowing circle</span>
        </div>
        <h3 className="text-xl" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}>{active.name}</h3>
        <p className="text-[12.5px] mt-1 opacity-75">Admin: {active.admin} · Code {active.code}</p>

        {active.memberOf ? (
          <div className="mt-3 inline-flex"><Badge tone="moss"><Check size={11} /> You're a member</Badge></div>
        ) : myRequest === "approved" ? (
          <div className="mt-3 inline-flex"><Badge tone="moss"><Check size={11} /> Access granted</Badge></div>
        ) : myRequest === "pending" ? (
          <div className="mt-3 flex items-center gap-2 text-[13px] opacity-80"><Loader2 size={13} className="animate-spin" /> Waiting on {active.admin.split(" ")[0]} to approve your request…</div>
        ) : (
          <button onClick={() => onJoinRequest(active.id, active.admin)} className="mt-3 px-3.5 py-2 rounded-md text-[13px] font-semibold" style={{ background: "#F2B705", color: "#22262B" }}>
            Request to join borrowing circle
          </button>
        )}
      </div>

      <div className="mb-2 text-[11px] uppercase tracking-wide" style={{ color: "#7a7362", fontFamily: "'IBM Plex Mono', monospace" }}>
        Share this library to a group
      </div>
      <div className="space-y-2 mb-4">
        <ShareRow icon={MessageCircle} label="Text message" color="#4C6444" onClick={() => share("text")} />
        <ShareRow icon={Send} label="WhatsApp" color="#25D366" onClick={() => share("whatsapp")} />
        <ShareRow icon={Facebook} label="Facebook Group" color="#1877F2" onClick={() => share("facebook")} />
        <ShareRow icon={Rss} label="Reddit" color="#FF4500" onClick={() => share("reddit")} />
        <ShareRow icon={Home} label="Nextdoor (copy text)" color="#8CC63F" onClick={copyLink} />
      </div>

      <button onClick={copyLink} className="w-full py-2.5 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2" style={{ background: "#22262B0D", color: "#1B1B1B" }}>
        <Copy size={14} /> Copy invite text
      </button>

      <div className="mt-6 rounded-lg p-4" style={{ background: "#F2B70522", border: "1px solid #F2B70555" }}>
        <div className="flex items-center gap-2 mb-1">
          <Bell size={14} style={{ color: "#8a6300" }} />
          <span className="text-[12.5px] font-semibold" style={{ color: "#1B1B1B" }}>Admin inbox</span>
        </div>
        <p className="text-[12px]" style={{ color: "#5b5648" }}>New join requests and address requests for your tools land here for approval.</p>
      </div>
    </div>
  );
}

/* --------------------------------- Header --------------------------------- */

function Logo({ size = 30 }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="rounded-full flex items-center justify-center flex-shrink-0"
        style={{ width: size, height: size, background: "#22262B", border: "2px solid #F2B705" }}
      >
        <Wrench size={size * 0.52} style={{ color: "#F2B705" }} strokeWidth={2.3} />
      </div>
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em", color: "#1B1B1B" }}>
        TOOLBER
      </span>
    </div>
  );
}

/* ---------------------------------- App ---------------------------------- */

const TABS = [
  { id: "browse", label: "Browse", icon: Search },
  { id: "mine", label: "My Tools", icon: Wrench },
  { id: "group", label: "Group", icon: Users },
];

export default function ToolberApp() {
  useFonts();
  const [tab, setTab] = useState("browse");
  const [tools, setTools] = useState(SEED_TOOLS);
  const [query, setQuery] = useState("");
  const [openTool, setOpenTool] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addressState, setAddressState] = useState({});
  const [joinRequests, setJoinRequests] = useState({});
  const [toasts, setToasts] = useState([]);
  const currentUser = "You";

  function pushToast(msg) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }

  function requestAddress(toolId, owner) {
    setAddressState((s) => ({ ...s, [toolId]: { state: "pending" } }));
    pushToast(`Address request sent to ${owner.split(" ")[0]}.`);
    setTimeout(() => {
      setAddressState((s) => ({ ...s, [toolId]: { state: "revealed" } }));
      pushToast(`${owner.split(" ")[0]} approved your address request.`);
    }, 1800);
  }

  function requestBorrow(tool) {
    setTools((ts) => ts.map((t) => (t.id === tool.id ? { ...t, status: "requested" } : t)));
    setOpenTool((t) => (t ? { ...t, status: "requested" } : t));
    pushToast(`Request sent to ${tool.owner.split(" ")[0]} for the ${tool.name}.`);
  }

  function joinRequest(groupId, admin) {
    setJoinRequests((s) => ({ ...s, [groupId]: "pending" }));
    pushToast(`Join request sent to ${admin.split(" ")[0]}.`);
    setTimeout(() => {
      setJoinRequests((s) => ({ ...s, [groupId]: "approved" }));
      pushToast(`${admin.split(" ")[0]} approved you for the borrowing circle!`);
    }, 1800);
  }

  function addTool(data) {
    const id = "t" + Math.random().toString(36).slice(2, 7);
    const colors = ["#F2B705", "#4C6444", "#B5502D"];
    setTools((ts) => [
      {
        id,
        name: data.name,
        category: data.category,
        description: data.description,
        owner: currentUser,
        groupId: "oakhill",
        neighborhood: "Oak Hill",
        address: "Your address (hidden until approved)",
        status: "available",
        monetize: data.monetize,
        price: data.price,
        color: colors[Math.floor(Math.random() * colors.length)],
      },
      ...ts,
    ]);
    pushToast(`${data.name} is on the pegboard.`);
  }

  const myTools = tools.filter((t) => t.owner === currentUser);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = tools.filter((t) => t.groupId === "oakhill");
    if (!q) return base;
    return base.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
  }, [tools, query]);

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background:
          "#E7DCC4 radial-gradient(circle, rgba(34,38,43,0.12) 1px, transparent 1.3px) 0 0/16px 16px",
      }}
    >
      <style>{`
        @keyframes fadein { from { opacity:0; transform: translateY(6px);} to {opacity:1; transform:translateY(0);} }
        input:focus, textarea:focus, button:focus-visible { outline: 2px solid #F2B705; outline-offset: 2px; }
        ::selection { background:#F2B705; color:#22262B; }
      `}</style>

      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur" style={{ background: "#E7DCC4ee", borderBottom: "2px solid #22262B" }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "#22262B", color: "#F2B705", fontFamily: "'IBM Plex Mono', monospace" }}>
            <MapPin size={11} /> Oak Hill
          </div>
        </div>
      </div>

      {/* Content */}
      {tab === "browse" && (
        <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#7a7362" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by what you need — “ladder”, “paint”, “drill bits”…"
              className="w-full pl-10 pr-3 py-3 rounded-md text-[14px] outline-none"
              style={{ background: "#FBF6EA", border: "1.5px solid #22262B33" }}
            />
          </div>
          {filtered.length === 0 ? (
            <div className="text-center py-16" style={{ color: "#7a7362" }}>
              <Wrench size={28} className="mx-auto mb-2 opacity-50" />
              <p className="text-[13.5px]">Nothing matches “{query}” yet. Maybe list it yourself?</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
              {filtered.map((t) => (
                <ToolCard key={t.id} tool={t} onOpen={setOpenTool} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "mine" && (
        <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
          <button onClick={() => setAddOpen(true)} className="w-full mb-5 py-3.5 rounded-md font-semibold text-[14px] flex items-center justify-center gap-2" style={{ background: "#22262B", color: "#F2B705" }}>
            <Plus size={16} /> List a tool to lend
          </button>
          {myTools.length === 0 ? (
            <div className="text-center py-16" style={{ color: "#7a7362" }}>
              <Hammer size={28} className="mx-auto mb-2 opacity-50" />
              <p className="text-[13.5px]">Your pegboard is empty. Add your first tool above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
              {myTools.map((t) => (
                <ToolCard key={t.id} tool={t} onOpen={setOpenTool} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "group" && (
        <GroupTab groups={GROUPS} onJoinRequest={joinRequest} joinRequests={joinRequests} pushToast={pushToast} />
      )}

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-30" style={{ background: "#22262B", borderTop: "2px solid #F2B705" }}>
        <div className="max-w-lg mx-auto flex">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 py-3 flex flex-col items-center gap-1">
                <Icon size={18} style={{ color: active ? "#F2B705" : "#8b8f95" }} />
                <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: active ? "#F2B705" : "#8b8f95", fontFamily: "'IBM Plex Mono', monospace" }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ToolModal
        tool={openTool}
        onClose={() => setOpenTool(null)}
        currentUser={currentUser}
        addressState={addressState}
        onRequestAddress={requestAddress}
        onRequestBorrow={requestBorrow}
      />
      <AddToolModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={addTool} />
      <Toast toasts={toasts} />
    </div>
  );
}
