"""Build a transferable source archive without dependencies, build output or signing keys."""
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parent.parent
output=root/'artifacts/folio-mobile-source.zip'
output.parent.mkdir(exist_ok=True)
folders=['.github','android','ios','docs','public','scripts','server','tests']
skip={'__pycache__','node_modules','.runtime','.gradle','build','DerivedData','Pods','xcuserdata','test-results','playwright-report','capacitor-cordova-android-plugins','capacitor-cordova-ios-plugins'}
files=[p for p in root.iterdir() if p.is_file() and (p.suffix in {'.js','.jsx','.css','.json','.md','.html'} or p.name in {'.gitignore','.env.example','Dockerfile'})]
for folder in folders:
 for p in (root/folder).rglob('*'):
  relative=p.relative_to(root)
  if not p.is_file() or any(part in skip for part in relative.parts): continue
  if p.suffix in {'.p12','.p8','.pem','.key','.keystore','.jks','.mobileprovision','.apk','.aab','.log'} or p.name=='local.properties': continue
  if relative.as_posix().startswith(('android/app/src/main/assets/','ios/App/App/public/')): continue
  if relative.as_posix()=='tests/pdf-mobile.png': continue
  files.append(p)
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
 for p in sorted(set(files)):
  archive.write(p,Path('folio')/p.relative_to(root))
print(output)
