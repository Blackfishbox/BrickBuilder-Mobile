# Standalone Android and Google Play preparation

This work lives on **`android/google-play`**. The GitHub `main` branch remains
the existing web/PWA application. Nothing uploads an app to Google Play.

## What runs locally

Capacitor 8 packages the Vite output into an Android WebView. Its secure
`https://localhost` origin is an **in-process asset handler**, not a hosted
web server or a connection to the developer's computer. JavaScript, Three.js,
workers, original bundled LDraw resources, connector metadata and the reviewed
catalog snapshot are installed with the app. IndexedDB remains local to the
Android application.

There is no `server.url`, live-reload host, API base URL, analytics SDK, account,
advertising SDK or Play upload client in the native application. Its manifest
does not request network or broad storage permission. The PWA service worker is
disabled for the native build; Android updates replace its packaged assets.
The ordinary web/PWA build remains unchanged.

### Important coverage limits

- The complete **mapping/search catalog is not the complete geometry library**.
  The two original bundled geometry packages contain six bricks and six plates.
  The existing import-geometry snapshot and geometries already present in a
  project/local database remain available.
- Importing LDR/MPD/IO does not magically supply every missing geometry. The
  native build will **not call the hosted geometry resolver** or silently fetch
  a newer upstream dataset. Missing parts retain the existing part-ID warnings.
  A complete, independently installable offline geometry distribution is a
  separate release prerequisite if the store listing promises that coverage.
- Native and browser IndexedDB are separate. Export projects from the PWA as
  internal JSON and import them into Android; do not clear the browser first.
- Local model import continues through the system file chooser. Model export
  and the inventory template use Android's local share/save sheet, not browser
  `blob:` downloads. Choose Files/a document provider there and verify the saved
  file. A cancelled share is not evidence that a backup exists.
- The app's permission-free implementation does not send models to a server.
  A share target selected by the user can itself be a cloud application.
- A browser/Node test is **not an Android hardware, WebGL, file-provider, memory
  or performance test**. These checks must happen before production submission.

## Identity, tools and versions

- Release application ID: `io.github.blackfishbox.brickbuilder`.
  Confirm it before the first Play upload: it cannot be changed for that listing.
- Debug ID: `io.github.blackfishbox.brickbuilder.debug`; separate projects and
  storage, allowing debug and release apps to coexist.
- Minimum Android: API 24 (Android 7). Target/compile: API 36 (Android 16).
  Actual 3D functionality also requires a working current Android System WebView
  and suitable WebGL/GPU support; the minSdk is not a performance guarantee.
- Node 24, pnpm 10.26.1, JDK 21, Android SDK platform 36 and build tools 36.0.0.
  Use Android Studio 2025.2.1 or newer for Capacitor 8.
- The checked-in Gradle wrapper uses Gradle 8.14.3 and Android Gradle Plugin 8.13.
- No NDK or bundled native `.so` library is introduced by this wrapper and its
  current Java plugins. Recheck 64-bit/16-KB requirements when adding plugins.

Google's policy checked on 2026-11-01 requires API 36 for new submissions
starting 2026-08-31. Recheck the official policy immediately before submission.

## Obtain the reviewed offline catalog

The hash and byte count are pinned in
`artifacts/brickbuilder-mobile/src/features/catalog/manifest.json`:

```text
SHA-256 ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c
Bytes   2180181
```

Keep `catalog.bin` outside Git, for example under
`generated-artifacts/android-inputs/`. Do not substitute a current live
Rebrickable download: its format and hashes differ.

An authorized existing development instance can supply the pinned asset:

```sh
mkdir -p generated-artifacts/android-inputs
curl --fail --location \
  'https://YOUR-DEVELOPMENT-OR-EXISTING-APP/api/catalog/snapshot/ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c' \
  -o generated-artifacts/android-inputs/catalog.bin
sha256sum generated-artifacts/android-inputs/catalog.bin
```

That source is needed **only at build time**, never on the Android device.
The preparation verifies both length and SHA-256 before copying the exact bytes
into the Android asset tree at the existing relative catalog path.

For repeatable GitHub builds, place this **licensed, non-user** data file in an
appropriate immutable downloadable asset location (for example, an approved
GitHub Release asset) and set repository Actions variable `ANDROID_CATALOG_URL`
to its public HTTPS download URL. Retain the Rebrickable attribution/terms
listed in the manifest. Never upload an IO model or private project as this
asset. No automatically refreshed external catalog is accepted.

The supplied `android-offline-inputs.zip` contains the reviewed `catalog.bin`,
its manifest and source/license metadata for this build. Keep a durable copy.
The archive itself is not a secret and contains no user model.

## Local build

From the repository root, with the Android SDK/JDK available:

```sh
pnpm install --frozen-lockfile
export ANDROID_CATALOG_PATH="$PWD/generated-artifacts/android-inputs/catalog.bin"
pnpm --filter @workspace/brickbuilder-mobile android:prepare
cd artifacts/brickbuilder-mobile/android
bash gradlew assembleDebug bundleRelease lintRelease
```

On Windows, set the same environment variables in PowerShell and use
`gradlew.bat`. `android:prepare` itself sets the Vite/native environment
cross-platform. Android Studio can manage your local SDK via
`android/local.properties`; never commit that file.

Outputs:

- `app/build/outputs/apk/debug/app-debug.apk`: installable test build.
- `app/build/outputs/bundle/release/app-release.aab`: **unsigned** without upload
  key configuration. It is not accepted by Google Play in this state.

An AAB is not directly installable like an APK. Use the APK for sideload testing
or Play's internal testing to exercise a signed AAB.

## GitHub Actions

Workflow: `.github/workflows/android-google-play.yml`.

1. Set Actions variable `ANDROID_CATALOG_URL` to the reviewed asset URL.
   Without this build input, automatic branch/tag runs skip the Android job
   rather than generate an incomplete or server-dependent application.
2. Push to `android/google-play` to build a debug APK and unsigned AAB.
3. Open Actions and download the output under that run's Artifacts section.
   Artifacts expire after 14 days: keep your own release archive.
4. For signed builds, create GitHub environment **`google-play-signing`**,
   preferably with required reviewers and restricted tags. Configure:
   - `ANDROID_UPLOAD_KEY_BASE64`
   - `ANDROID_UPLOAD_STORE_PASSWORD`
   - `ANDROID_UPLOAD_KEY_ALIAS`
   - `ANDROID_UPLOAD_KEY_PASSWORD`
5. Set `ANDROID_VERSION_NAME` (for example `0.1.0`). Push a deliberately chosen
   `android-play-v...` tag from this Android branch to request signed artifacts.
   Do not create such a tag just to try an unconfigured pipeline.

For example, after configuring the environment and reviewing the branch:

```sh
git tag android-play-v0.1.0
git push origin android-play-v0.1.0
```

Push-triggered builds use the workflow run number as `versionCode`; **every
Play upload must have a strictly higher code than the previous upload**.
Check before uploading, especially after moving/recreating workflows. The
workflow also offers explicit code/name inputs for `workflow_dispatch`.
GitHub normally exposes manual dispatch only when that workflow also exists
on the repository's default branch; this preparation deliberately does not
modify `main`. Branch/tag push triggers work without that default-branch change.

Signed builds require all four signing secrets, verify AAB/APK signatures, use
temporary runner files and delete the decoded key afterward. They never use a
debug key for a release and never call the Play Publishing API. Build scripts
do not generate or take possession of your permanent signing key.

GitHub-hosted runner minutes/storage are subject to your GitHub account's
allowance and spending settings. No paid service is configured or purchased.

## Upload key and Play App Signing

Create an upload key locally using Android Studio's **Generate Signed Bundle**
flow or `keytool`, protect it with a strong password, and maintain a secure
offline backup. Store key material only in your own secure storage and GitHub
environment secrets, never in source, chat, an artifact or a public issue.
Enable **Play App Signing** in the Play Console. The upload key and Play's app
signing key have different roles; do not substitute the debug key.

For local signed builds, set these environment variables without putting their
values in project files:

```text
ANDROID_UPLOAD_STORE_FILE       absolute path to your upload keystore
ANDROID_UPLOAD_STORE_PASSWORD   keystore password
ANDROID_UPLOAD_KEY_ALIAS        upload key alias
ANDROID_UPLOAD_KEY_PASSWORD     key password
ANDROID_REQUIRE_SIGNING         true
BRICKBUILDER_VERSION_CODE       a new positive increasing number
BRICKBUILDER_VERSION_NAME       e.g. 0.1.0
```

Then run `bash gradlew assembleRelease bundleRelease lintRelease`.

## Play Console checklist — not completed by generating a bundle

- Register/verify the correct developer account. Google may charge a developer
  registration fee; no account or purchase is created by this preparation.
- Confirm application ID, publisher name, support contact and countries.
- Review the offline coverage above and use truthful listing text. The app is
  independent of LEGO, BrickLink, Studio, Rebrickable and LDraw; do not imply
  endorsement or use protected logos as your branding.
- Prepare a 512×512 store icon, 1024×500 feature graphic and genuine Android
  screenshots. Existing browser previews are not native-device screenshots.
  The Android launcher uses the included first-party vector icon.
- Finalize and publish a public HTTPS privacy policy. Start from
  `docs/android-privacy-policy-template.md`, replacing all publisher/contact
  fields. Complete Data safety, ads declaration, content rating, target audience
  and app access declarations based on the actual final binary and SDKs.
- Check per-file LDraw attribution/CC BY and CC0, LDCad shadow CC BY-SA metadata
  obligations and Rebrickable terms for distribution. Keep app code and data
  licensing separate; do not claim the entire payload has one MIT license.
- Use internal testing first. New personal accounts can have mandatory closed
  testing/device verification before production access; follow the current
  requirements shown for your account.
- Test offline immediately after a fresh installation, import/export/save,
  sharing cancellation and low storage, background/kill/restart recovery,
  orientation and system bars, touch gestures, standard snapping, large models
  and devices/WebViews at your declared minimum and current Android.
- Upload the verified **signed AAB**, inspect Play's warnings/pre-launch report,
  and request review only after the above checks. There is no approval guarantee.

## Preparation verification and remaining release gates

The native web payload build, embedded catalog checksum, Capacitor plugin sync,
TypeScript and local export/transport tests can be verified in this workspace.
A native Gradle APK/AAB build requires an Android SDK/JDK or a configured Actions
runner. A generated Gradle project alone is not proof of an installable APK.

The first successful native CI build, real-device testing, signing setup, final
store graphics, publisher/privacy details and Play Console submission remain
explicit release gates. A complete offline geometry expansion is not silently
included or promised by this preparation.

## Official references

- https://capacitorjs.com/docs/getting-started/environment-setup
- https://capacitorjs.com/docs/android
- https://developer.android.com/studio/publish/app-signing
- https://developer.android.com/guide/app-bundle
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/10787469
