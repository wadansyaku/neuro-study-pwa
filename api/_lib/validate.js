async function readJsonBody(req){
  const chunks = [];
  for await (const chunk of req){
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if(!raw) return {};
  return JSON.parse(raw);
}

function requireString(value, name){
  if(typeof value !== "string" || !value.trim()){
    const error = new Error(`${name} is required`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function requireArray(value, name){
  if(!Array.isArray(value)){
    const error = new Error(`${name} must be an array`);
    error.status = 400;
    throw error;
  }
  return value;
}

export {readJsonBody, requireString, requireArray};
