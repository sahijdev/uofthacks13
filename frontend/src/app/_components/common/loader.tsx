export default function LegoLoader() {
  return (
    <div className="flex gap-3">
      <Brick color="bg-red-600" delay="0s" />
      <Brick color="bg-blue-600" delay="0.2s" />
      <Brick color="bg-yellow-400" delay="0.4s" />
    </div>
  );
}

function Brick({
  color,
  delay,
}: {
  color: string;
  delay: string;
}) {
  return (
    <div
      style={{ animationDelay: delay }}
      className={`
        relative h-8 w-16 rounded
        ${color}
        animate-lego
      `}
    >
      {/* studs */}
      <div className="absolute -top-1.5 left-2 flex gap-2">
        <span className="h-3 w-3 rounded-full bg-white/30" />
        <span className="h-3 w-3 rounded-full bg-white/30" />
        <span className="h-3 w-3 rounded-full bg-white/30" />
      </div>
    </div>
  );
}
