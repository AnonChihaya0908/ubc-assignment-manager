# UBC Assignment Manager

A desktop app that brings PrairieLearn and UBC WeBWorK assignments, opening dates, due dates, and reminders into one place. The Windows app is the stable edition; the macOS app is a preview.

[Latest stable release](https://github.com/AnonChihaya0908/ubc-assignment-manager/releases/latest) · [Windows and macOS 1.3.0 preview](https://github.com/AnonChihaya0908/ubc-assignment-manager/releases/tag/v1.3.0) · [Report a problem](https://github.com/AnonChihaya0908/ubc-assignment-manager/issues) · [中文说明](README.md)

This is an independent project. It is not an official UBC, PrairieLearn, or WeBWorK app. It reads assignments visible to you after you sign in; it does not need a PrairieLearn API token.

## Install

**Windows:** Download the setup executable from the latest stable release and run it. The installer is per user. The portable ZIP also works, but extract the entire archive before opening the executable; the bundled runtime files are required. No separate Node.js installation or terminal command is needed.

**macOS preview:** Download the `macos-arm64.pkg` for Apple Silicon or `macos-x64.pkg` for Intel from the 1.3.0 preview release. The package installs a standalone `.app` in Applications. This preview is unsigned and unnotarized and has not yet completed first-install testing on a physical Mac. macOS may block the package or app. If you trust the release and want to proceed, try opening it once, then use **System Settings → Privacy & Security → Open Anyway**. Follow the system prompt. See [Apple’s guidance](https://support.apple.com/en-us/102445) for the current steps. The published 1.3.0 preview still needs Edge. Current source adds built-in WebKit sign-in and sync, pending physical Mac verification.

## First use

1. On first launch, paste your own student assignment list URL. PrairieLearn URLs end in `/pl/course_instance/<number>/assessments`; UBC WeBWorK URLs begin with `https://webwork.elearning.ubc.ca/webwork2/`.
2. Go to **Settings → Courses and login** and open the dedicated sign-in window for each course. Current source supports Edge and Chrome, with built-in WebKit as the Mac default. Complete your school sign-in, then return to the app and choose **Hide sign-in window**.
3. Select **Sync now** in the lower left. The app reads course pages through the same dedicated profile in the background and keeps it available for scheduled syncs. If school sign-in expires, reopen the sign-in window from course settings. This profile is separate from your everyday browser.
4. The app starts in your device language. Change it at **Settings → General and window → Display language**. Language changes do not change assignment dates, completion states, sign-in sessions, or other settings.

If PrairieLearn syncing fails, you can copy its assignment table from an already signed-in browser and use the manual import under Courses and login. WeBWorK must sync through the dedicated sign-in window. Newly installed copies do not contain another user’s courses. Imported or older courses must be confirmed before the app opens their pages, syncs them, or sends reminders.

## Reminders and data

Deadline notifications use the computer’s local time zone. Closing the main window keeps the app running in the Windows tray or macOS menu bar. Fully quitting the app or shutting down the computer stops real-time local notifications and syncing. A daily WeChat digest is optional and requires your own ServerChan Turbo SendKey; assignment names and dates are sent through that service only if you enable it.

Daily email reminders are also optional. In **Settings → Reminders and sync**, connect your own Gmail address with a Gmail app password, send a test email to your recipient, then enable the daily schedule. The digest includes unfinished assignments, due dates, and source links. The app does not request your main Gmail password or require a hosted server. Gmail app passwords require eligible two-step verification; some school or work accounts restrict them. Outlook sending is not supported in this version because it requires a separate OAuth authorization integration. See [email reminder setup and limits](docs/email-reminders.md). Missed mail is sent only on the same day after the app resumes, with up to three attempts.

Backups include courses, cached assignments, notes, and ordinary settings. They exclude cookies, browser sign-in profiles, the SendKey, email sender authorization, and delivery history. On Mac, updates are currently installed by downloading a new `.pkg`; Windows releases support in-app installation and restart.
