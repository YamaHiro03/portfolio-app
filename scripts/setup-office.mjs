// Rootless Linux setup. Stores the conversion engine inside this project, never /tmp.
import {spawnSync} from 'node:child_process';
import {mkdir,cp,readdir,readFile,writeFile,readlink,unlink,symlink,access,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url)),base=join(project,'.runtime','office'),root=join(base,'root');
function run(command,args,options={}){const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024,...options});if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} failed: ${result.stderr||result.stdout}`);return result.stdout}
const exists=async p=>{try{await access(p);return true}catch{return false}};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
async function walk(dir,fn){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);await fn(path,entry);if(entry.isDirectory())await walk(path,fn)}}
try{
 if(process.platform!=='linux')throw Error('Linuxではこのセットアップを使用できます。Windows/macOSではLibreOfficeをインストールするかLIBREOFFICE_BINを指定してください。');
 await mkdir(base,{recursive:true});
 const sourceIndex=process.argv.indexOf('--from');
 if(sourceIndex!==-1){await cp(resolve(process.argv[sourceIndex+1]),root,{recursive:true,dereference:false});}
 else if(!await exists(join(root,'usr/lib/libreoffice/program/soffice'))){
  const plan=run('apt-get',['-s','--no-install-recommends','install','libreoffice-writer','libreoffice-impress','libreoffice-calc','fonts-noto-cjk']);
  const packages=[...new Set(['libreoffice-writer','libreoffice-impress','libreoffice-calc','libreoffice-common','uno-libs-private','fonts-noto-cjk',...plan.split('\n').filter(l=>l.startsWith('Inst ')).map(l=>l.split(' ')[1])])];
  const downloads=join(base,'packages');await mkdir(downloads,{recursive:true});console.log('Downloading LibreOffice and dependencies…');run('apt-get',['download',...packages],{cwd:downloads});
  for(const name of await readdir(downloads))if(name.endsWith('.deb'))run('dpkg-deb',['-x',join(downloads,name),root]);
 }
 const previous='/tmp/folio-runtime/extracted';
 await walk(root,async(p,entry)=>{if(entry.isSymbolicLink()){const target=await readlink(p);const mapped=target.startsWith(previous)?root+target.slice(previous.length):target.startsWith('/')?root+target:null;if(mapped&&await exists(mapped)){await unlink(p);await symlink(mapped,p)}}});
 const program=join(root,'usr/lib/libreoffice/program'),programUrl=pathToFileURL(program).href;
 for(const name of ['fundamentalrc','sofficerc','unorc','bootstraprc','lounorc']){const p=join(program,name);let text=await readFile(p,'utf8');text=text.replaceAll(pathToFileURL(previous).href,pathToFileURL(root).href).replaceAll('file:///usr/',pathToFileURL(join(root,'usr')).href+'/').replaceAll('file:///etc/',pathToFileURL(join(root,'etc')).href+'/');await writeFile(p,text)}
 const arch=run('dpkg-architecture',['-qDEB_HOST_MULTIARCH']).trim(),libs=join(root,'usr/lib',arch);await mkdir(libs,{recursive:true});
 await writeFile(join(libs,'unorc'),(await readFile(join(program,'unorc'),'utf8')).replaceAll('${ORIGIN}',programUrl));
 for(const [link,target] of [[join(libs,'libgcc3_uno.so'),join(program,'libgcc3_uno.so')],[join(root,'usr/lib/libreoffice/share/registry/main.xcd'),join(root,'usr/lib/libreoffice/share/.registry/main.xcd')]]){try{await unlink(link)}catch(e){if(e.code!=='ENOENT')throw e}await symlink(target,link)}
 // Debian normally installs the language database to a global path. Point the managed engine to its own copy.
 const shimSource=join(base,'language-data.c'),shim=join(base,'language-data.so');
 await writeFile(shimSource,`extern void lt_db_set_datadir(const char*);\n__attribute__((constructor)) static void initialize(void){lt_db_set_datadir(${JSON.stringify(join(root,'usr/share/liblangtag'))});}\n`);
 run('cc',['-shared','-fPIC',shimSource,join(libs,'liblangtag.so.1'),'-o',shim]);
 const fontDir=join(root,'usr/share/fonts'),cache=join(base,'font-cache');await mkdir(cache,{recursive:true});
 const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
 await writeFile(join(base,'fonts.conf'),`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${xml(fontDir)}</dir><cachedir>${xml(cache)}</cachedir></fontconfig>`);
 await writeFile(join(base,'soffice'),`#!/bin/sh\nexport LD_LIBRARY_PATH=${quote(base+':'+libs+':'+program)}\nexport LD_PRELOAD=${quote('language-data.so')}\nexport FONTCONFIG_FILE=${quote(join(base,'fonts.conf'))}\nexec ${quote(join(program,'soffice'))} "$@"\n`);await chmod(join(base,'soffice'),0o755);
 const version=run(join(base,'soffice'),['--headless','--version']);console.log(version.trim());console.log('Ready. npm run dev / npm start automatically use this engine.');
}catch(e){console.error('Office setup failed:',e.message);process.exitCode=1}
