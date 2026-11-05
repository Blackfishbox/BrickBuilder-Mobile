# Local Android privacy policy

The German, user-facing policy is the self-contained HTML page at
`artifacts/brickbuilder-mobile/public/privacy.html`. It applies only to the
server-free Android build, not hosted PWA installations. It is accessible from
the project menu without leaving the editor, is bundled for offline access and
contains no scripts, remote fonts or external images.

Before store publication:

1. Have the text legally reviewed and verify the actual release still matches
   its statements, especially native geometry transport, sharing, local storage
   and the absence of analytics/advertising SDKs.
2. Upload the same HTML document to a publicly accessible, stable HTTPS URL.
   No login, geofencing, PDF-only download or editable-document link should be
   required. No public URL has been configured or published by this change.
3. Enter that URL in Play Console. Complete the Data safety form based on the
   actual release and Google's definitions; a policy alone does not complete it.
4. If a website is used, separately assess its host, access logs and other data
   processing. Do not claim this Android-only policy covers hosted web apps.
5. If optional services, SDKs, cloud sync or network downloads are introduced,
   review the policy and store disclosures before release.

User-selected cloud document providers and share targets can transfer exported
files independently. The native exporter leaves files in the app cache until
Android/the user clears them; the policy deliberately does not promise immediate
deletion or additional file encryption.

Official reference:
https://support.google.com/googleplay/android-developer/answer/10144311
