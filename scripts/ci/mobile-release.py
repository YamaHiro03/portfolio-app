"""Cloud-runner release build. Requires npm ci and npm run mobile:sync first."""
import base64
import datetime
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts'


def required(name):
    value = os.environ.get(name, '')
    if not value:
        raise ValueError(f'Missing environment variable: {name}')
    return value


def run(*args, **kwargs):
    return subprocess.run(list(map(str, args)), check=True, cwd=ROOT, **kwargs)


def decode(name, path):
    path.write_bytes(base64.b64decode(required(name), validate=True))
    path.chmod(0o600)


def version():
    number = required('BUILD_NUMBER')
    if not re.fullmatch(r'[1-9][0-9]{0,8}', number):
        raise ValueError('BUILD_NUMBER must be a positive integer with at most 9 digits')
    name = os.environ.get('VERSION_NAME') or json.loads((ROOT / 'package.json').read_text())['version']
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', name):
        raise ValueError('VERSION_NAME must be major.minor.patch')
    return number, name


def android():
    number, name = version()
    for key in ('ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'):
        required(key)
    with tempfile.TemporaryDirectory(prefix='folio-signing-') as directory:
        key = Path(directory) / 'release.jks'
        decode('ANDROID_KEYSTORE_BASE64', key)
        env = dict(os.environ, ANDROID_KEYSTORE_PATH=str(key), BUILD_NUMBER=number, VERSION_NAME=name)
        run('bash', 'android/gradlew', '-p', 'android', ':app:assembleRelease', ':app:bundleRelease', '--no-daemon', env=env)
        sdk = Path(os.environ.get('ANDROID_HOME') or required('ANDROID_SDK_ROOT'))
        signer = sdk / 'build-tools/35.0.0/apksigner'
        apk = ROOT / 'android/app/build/outputs/apk/release/app-release.apk'
        aab = ROOT / 'android/app/build/outputs/bundle/release/app-release.aab'
        run(signer, 'verify', '--verbose', apk)
        # jarsigner verification alone can exit 0 for unsigned archives; require a signature entry too.
        import zipfile
        with zipfile.ZipFile(aab) as archive:
            if not any(p.startswith('META-INF/') and p.endswith(('.RSA', '.DSA', '.EC')) for p in archive.namelist()):
                raise ValueError('AAB is not signed')
        run('jarsigner', '-verify', aab)
        shutil.copy2(apk, OUT / 'folio-android-release.apk')
        shutil.copy2(aab, OUT / 'folio-android-release.aab')


def ios():
    if sys.platform != 'darwin':
        raise ValueError('iOS release requires a macOS runner with Xcode 26 or later')
    number, name = version()
    password = required('IOS_CERTIFICATE_PASSWORD')
    team = required('IOS_TEAM_ID')
    method = os.environ.get('IOS_EXPORT_METHOD', 'app-store-connect')
    if method not in ('app-store-connect', 'release-testing'):
        raise ValueError('Unsupported IOS_EXPORT_METHOD')
    bundle = 'app.folio.student'
    old_keychains = subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True)
    import shlex
    old_keychains = shlex.split(old_keychains)
    installed = None
    with tempfile.TemporaryDirectory(prefix='folio-signing-') as directory:
        temp = Path(directory)
        keychain = temp / 'signing.keychain-db'
        p12 = temp / 'certificate.p12'
        profile = temp / 'profile.mobileprovision'
        decode('IOS_CERTIFICATE_BASE64', p12)
        decode('IOS_PROFILE_BASE64', profile)
        key_password = __import__('secrets').token_hex(32)
        try:
            run('security', 'create-keychain', '-p', key_password, keychain)
            run('security', 'set-keychain-settings', '-lut', '21600', keychain)
            run('security', 'unlock-keychain', '-p', key_password, keychain)
            run('security', 'import', p12, '-P', password, '-A', '-t', 'cert', '-f', 'pkcs12', '-k', keychain, stdout=subprocess.DEVNULL)
            run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', key_password, keychain, stdout=subprocess.DEVNULL)
            run('security', 'list-keychains', '-d', 'user', '-s', keychain, *old_keychains)
            data = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(profile)]))
            if data['ExpirationDate'] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
                raise ValueError('Provisioning profile expired')
            if team not in data['TeamIdentifier'] or data['Entitlements']['application-identifier'] != f'{team}.{bundle}':
                raise ValueError('Profile must match IOS_TEAM_ID and app.folio.student')
            if data['Entitlements'].get('get-task-allow'):
                raise ValueError('Use a distribution profile, not a development profile')
            has_devices = bool(data.get('ProvisionedDevices'))
            if has_devices != (method == 'release-testing') or data.get('ProvisionsAllDevices'):
                raise ValueError('Profile distribution type does not match IOS_EXPORT_METHOD')
            uuid = data['UUID']
            if not re.fullmatch(r'[A-Fa-f0-9-]+', uuid):
                raise ValueError('Invalid profile UUID')
            profiles = Path.home() / 'Library/MobileDevice/Provisioning Profiles'
            profiles.mkdir(parents=True, exist_ok=True)
            destination = profiles / f'{uuid}.mobileprovision'
            if destination.exists():
                raise ValueError('Use a fresh ephemeral macOS runner (profile already installed)')
            installed = destination
            shutil.copy2(profile, installed)
            options = temp / 'ExportOptions.plist'
            options.write_bytes(plistlib.dumps({
                'method': method, 'destination': 'export', 'signingStyle': 'manual',
                'teamID': team, 'signingCertificate': 'Apple Distribution',
                'provisioningProfiles': {bundle: uuid}, 'manageAppVersionAndBuildNumber': False,
            }))
            archive = temp / 'folio.xcarchive'
            run('xcodebuild', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App',
                '-configuration', 'Release', '-destination', 'generic/platform=iOS',
                '-archivePath', archive, f'DEVELOPMENT_TEAM={team}', 'CODE_SIGN_STYLE=Manual',
                'CODE_SIGN_IDENTITY=Apple Distribution', f'PROVISIONING_PROFILE_SPECIFIER={uuid}',
                f'CURRENT_PROJECT_VERSION={number}', f'MARKETING_VERSION={name}', 'archive')
            run('xcodebuild', '-exportArchive', '-archivePath', archive,
                '-exportOptionsPlist', options, '-exportPath', temp / 'export')
            ipas = list((temp / 'export').glob('*.ipa'))
            if len(ipas) != 1:
                raise ValueError('Expected exactly one exported IPA')
            shutil.copy2(ipas[0], OUT / 'folio-ios.ipa')
        finally:
            if installed and installed.exists() and installed.read_bytes() == profile.read_bytes():
                installed.unlink()
            subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *old_keychains], check=False)
            subprocess.run(['security', 'delete-keychain', str(keychain)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    try:
        OUT.mkdir(exist_ok=True)
        {'android': android, 'ios': ios}[sys.argv[1]]()
    except (ValueError, KeyError, IndexError) as error:
        sys.exit(str(error))
    except subprocess.CalledProcessError as error:
        # Do not print command arguments: security import includes certificate passwords.
        sys.exit(f'Build command failed with exit code {error.returncode}')
