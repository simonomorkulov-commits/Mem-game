export const ROOM_PLANNER_VERSION = 'balanced-doors-v1';
const roomRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
function roomShuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function planRooms(levels, random = roomRandom) {
  const targets = levels.map(level => level.target), exposure = new Map(), lastShown = new Map();
  // Each automatic block draws every sound once per shuffled bag, without boundary repeats.
  for (let i = 0; i < levels.length;) {
    if (!levels[i].automaticPool) { i++; continue; }
    const pool = [...new Map(levels[i].automaticPool.map(m => [m.id, m])).values()];
    const signature = pool.map(m => m.id).join('|'); let end = i + 1;
    while (end < levels.length && levels[end].automaticPool?.map(m => m.id).join('|') === signature) end++;
    let bag = [], prior = targets[i - 1]?.id;
    for (let index = i; index < end; index++) {
      if (!bag.length) {
        bag = roomShuffle(pool, random);
        const forbidden = index === i && i > 0 ? new Set(levels[i - 1].options.map(m => m.id)) : new Set([prior]);
        const allowed = bag.findIndex(m => !forbidden.has(m.id));
        if (allowed > 0) [bag[0], bag[allowed]] = [bag[allowed], bag[0]];
      }
      targets[index] = bag.shift(); prior = targets[index].id;
    }
    i = end;
  }
  const result = [];
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i], target = targets[i], previous = new Set(result.at(-1)?.options.map(m => m.id) || []);
    let options;
    if (!level.automaticPool) options = roomShuffle(level.options, random);
    else {
      const pool = [...new Map(level.automaticPool.map(m => [m.id, m])).values()];
      const candidates = roomShuffle(pool.filter(m => m.id !== target.id), random);
      candidates.sort((a, b) => {
        const recent = Number(previous.has(a.id)) - Number(previous.has(b.id));
        if (recent) return recent;
        const nextTarget = Number(a.id === targets[i + 1]?.id) - Number(b.id === targets[i + 1]?.id);
        if (nextTarget) return nextTarget;
        return (exposure.get(a.id) || 0) - (exposure.get(b.id) || 0) || (lastShown.get(a.id) ?? -1) - (lastShown.get(b.id) ?? -1);
      });
      options = roomShuffle([target, ...candidates.slice(0, 2)], random);
    }
    for (const meme of options) { exposure.set(meme.id, (exposure.get(meme.id) || 0) + 1); lastShown.set(meme.id, i); }
    result.push({ id: level.id, title: level.title, theme: level.theme, target, options, planner: ROOM_PLANNER_VERSION });
  }
  return result;
}
