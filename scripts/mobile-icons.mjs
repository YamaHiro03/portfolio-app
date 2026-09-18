import sharp from 'sharp';import {readFile,readdir} from 'node:fs/promises';
const icon=await readFile(new URL('../public/folio-icon.svg',import.meta.url));
const densities={mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192};
for(const [density,size] of Object.entries(densities)){for(const name of ['ic_launcher','ic_launcher_round','ic_launcher_foreground'])await sharp(icon).resize(name==='ic_launcher_foreground'?Math.round(size*2.25):size).png().toFile(`android/app/src/main/res/mipmap-${density}/${name}.png`)}
await sharp(icon).png().toFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
const splash=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732"><rect width="2732" height="2732" fill="#f8f9f6"/></svg>');
const small=await sharp(icon).resize(420).png().toBuffer();const data=await sharp(splash).composite([{input:small,gravity:'center'}]).png().toBuffer();
for(const name of ['splash-2732x2732.png','splash-2732x2732-1.png','splash-2732x2732-2.png'])await sharp(data).toFile('ios/App/App/Assets.xcassets/Splash.imageset/'+name);
for(const directory of await readdir('android/app/src/main/res'))if(directory.startsWith('drawable')){const target=`android/app/src/main/res/${directory}/splash.png`;try{const {width,height}=await sharp(await readFile(target)).metadata();await sharp({create:{width,height,channels:3,background:'#f8f9f6'}}).composite([{input:await sharp(icon).resize(Math.round(Math.min(width,height)*.24)).png().toBuffer(),gravity:'center'}]).png().toFile(target)}catch(error){if(error.code!=='ENOENT')throw error}}
