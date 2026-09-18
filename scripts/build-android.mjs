import {readFile,copyFile,mkdir,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
let env={...process.env};
try{const local=JSON.parse(await readFile(path.join(root,'.runtime/mobile-build/environment.json'),'utf8'));env={...env,JAVA_HOME:env.JAVA_HOME||local.java,ANDROID_HOME:env.ANDROID_HOME||local.sdk,ANDROID_SDK_ROOT:env.ANDROID_SDK_ROOT||local.sdk,JAVA_TOOL_OPTIONS:env.JAVA_TOOL_OPTIONS||local.javaOptions||''}}catch{}
env.GRADLE_USER_HOME=env.GRADLE_USER_HOME||path.join(root,'.runtime/mobile-build/gradle');
const command=process.platform==='win32'?'gradlew.bat':'./gradlew';
const code=await new Promise((resolve,reject)=>{const child=spawn(command,[':app:assembleDebug','--no-daemon'],{cwd:path.join(root,'android'),env,stdio:'inherit',shell:process.platform==='win32'});child.on('error',reject);child.on('exit',resolve)});
if(code!==0)process.exit(code||1);
const target=path.join(root,'artifacts/folio-android-debug.apk');await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'),target);console.log('Android APK: '+target);
