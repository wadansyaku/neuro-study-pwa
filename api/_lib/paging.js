function parseLimit(raw, {min = 1, max = 500, fallback = 100} = {}){
  const num = Number(raw);
  if(!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function parseCursor(raw){
  if(raw === null || raw === undefined || raw === "") return null;
  const num = Number(raw);
  if(!Number.isFinite(num)) return null;
  return Math.floor(num);
}

export {parseLimit, parseCursor};
