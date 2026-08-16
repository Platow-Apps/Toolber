export default function ComingSoon({ title, note }) {
  return (
    <div>
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <p className="font-condensed text-xl font-bold uppercase tracking-wide text-safety">{title}</p>
      </div>
      <div className="px-4 py-16 text-center text-muted">
        <p className="text-sm">{note ?? "This screen isn't wired up to real data yet — coming in the next build pass."}</p>
      </div>
    </div>
  );
}
