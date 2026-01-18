export type PersonaKey = "cosmic" | "mech" | "architect" | "eco" | "whimsy";

export function classifyPersonaLocal(prompts: string[]): PersonaKey {
  const text = prompts.join(" ").toLowerCase();

  const keywords: Record<PersonaKey, string[]> = {
    cosmic: [
      "space",
      "rocket",
      "shuttle",
      "orbit",
      "planet",
      "galaxy",
      "ufo",
      "starfighter",
      "spaceship",
      "moon",
      "asteroid",
    ],
    mech: ["mech", "robot", "walker", "tank", "drone", "exosuit", "battle", "cannon", "gear", "engine", "industrial"],
    architect: [
      "house",
      "cottage",
      "villa",
      "bridge",
      "tower",
      "castle",
      "skyscraper",
      "pavilion",
      "city",
      "street",
      "fort",
      "apartment",
      "lodge",
      "building",
      "architecture",
      "structure",
      "stairs",
      "roof",
    ],
    eco: ["tree", "forest", "garden", "river", "pond", "lake", "animal", "creature", "nature", "eco", "biome", "jungle", "mountain", "beach", "island", "farm"],
    whimsy: ["cute", "fun", "whimsy", "toy", "character", "dragon", "fantasy", "pirate", "wizard", "fairy", "mascot", "party", "festival", "balloon"],
  };

  const score: Record<PersonaKey, number> = { cosmic: 0, mech: 0, architect: 0, eco: 0, whimsy: 0 };

  (Object.keys(keywords) as PersonaKey[]).forEach((key) => {
    const list = keywords[key];
    list.forEach((kw) => {
      const re = new RegExp(`\\b${kw}\\w*\\b`, "g");
      const matches = text.match(re);
      if (matches) {
        score[key] += matches.length * (key === "architect" && kw === "house" ? 3 : 2);
      }
    });
  });

  // General architecture boosters for repeated structural words
  const structuralHits = (text.match(/\b(room|wall|floor|roof|door|window|brickwork|layout)\w*\b/g) || []).length;
  score.architect += structuralHits;

  // If nothing matched, fall back to whimsy
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) return "whimsy";

  return best[0] as PersonaKey;
}
