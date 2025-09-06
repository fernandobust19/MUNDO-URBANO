// tools/download-assets.js - descarga todas las imágenes definidas en images.json
const fs = require('fs');
const path = require('path');

const IMG_MAP = require('../images.json');
const OUT_DIR = path.join(__dirname, '..', 'game-assets');

async function main(){
  if(!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
  const outMap = {};
  let ok=0, fail=0;
  for(const [key, url] of Object.entries(IMG_MAP)){
    try{
      const res = await fetch(url);
      if(!res.ok) throw new Error('bad upstream '+res.status);
      const ct = res.headers.get('content-type') || 'image/png';
      const ext = ct.includes('jpeg')?'.jpg': ct.includes('png')?'.png' : ct.includes('gif')?'.gif' : ct.includes('webp')?'.webp' : '.img';
      const filename = key.replace(/[^a-z0-9_\- ]/gi,'_') + ext;
      const filePath = path.join(OUT_DIR, filename);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(filePath, buf);
      outMap[key] = 'game-assets/' + filename;
      ok++;
    }catch(e){
      console.warn('fail', key, e.message);
      fail++;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'map.json'), JSON.stringify(outMap, null, 2));
  console.log('done. ok:', ok, 'fail:', fail);
}

main().catch(e=>{ console.error(e); process.exit(1); });
