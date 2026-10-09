# UBC Assignment Manager

A desktop app that brings PrairieLearn, UBC WeBWorK, and Gradescope Canada assignments, opening dates, due dates, and reminders into one place.

[Version 1.3.4 for Windows and macOS](https://github.com/AnonChihaya0908/ubc-assignment-manager/releases/tag/v1.3.4) · [Report a problem](https://github.com/AnonChihaya0908/ubc-assignment-manager/issues) · [中文说明](README.md)

Version 1.3.4 includes Gradescope Canada course support. Syncing an unsubmitted assignment and a graded assignment has been verified on a real Windows course page; macOS WebKit still needs real-account testing.

This is an independent project. It is not an official UBC, PrairieLearn, WeBWorK, or Gradescope app. It reads assignments visible to you after you sign in; it does not need a PrairieLearn API token.

## Install

**Windows:** Download the setup executable from the latest stable release and run it. The installer is per user. The portable ZIP also works, but extract the entire archive before opening the executable; the bundled runtime files are required. No separate Node.js installation or terminal command is needed.

**macOS:** Version 1.3.4 provides `macos-arm64.dmg` / `.zip` for Apple Silicon and `macos-x64.dmg` / `.zip` for Intel. Open the DMG and drag the app to Applications, or extract the ZIP and move the entire `.app` there. PKG remains available. The app has an ad hoc integrity signature but no Developer ID signature or notarization; a physical Mac first-install and notification check is still outstanding. Changing archive format does not bypass macOS app security checks. If you trust the release and want to proceed, try opening the app once, then use **System Settings → Privacy & Security → Open Anyway** if offered. See [Apple’s guidance](https://support.apple.com/en-us/102445) for the current steps. Built-in WebKit handles sign-in and sync by default.

## First use

1. On first launch, paste your own student assignment list URL. PrairieLearn URLs end in `/pl/course_instance/<number>/assessments`; UBC WeBWorK URLs begin with `https://webwork.elearning.ubc.ca/webwork2/`; Gradescope Canada course URLs use `https://www.gradescope.ca/courses/<number>`.
2. Go to **Settings → Courses and login** and open the dedicated sign-in window for each course. Current source supports Edge and Chrome, with built-in WebKit as the Mac default. Complete your school sign-in, then return to the app and choose **Hide sign-in window**.
3. Select **Sync now** in the lower left. The app reads course pages through the same dedicated profile in the background and keeps it available for scheduled syncs. If school sign-in expires, reopen the sign-in window from course settings. This profile is separate from your everyday browser.
4. The app starts in your device language. Change it at **Settings → General and window → Display language**. Language changes do not change assignment dates, completion states, sign-in sessions, or other settings.

If PrairieLearn syncing fails, you can copy its assignment table from an already signed-in browser and use the manual import under Courses and login. WeBWorK and Gradescope must sync through the dedicated sign-in window. Gradescope uses the regular due date for reminders, shows a late due date separately, and treats a submission or published grade as complete even below full credit. Newly installed copies do not contain another user’s courses. Imported or older courses must be confirmed before the app opens their pages, syncs them, or sends reminders.

## Reminders and data

Deadline notifications use the computer’s local time zone. Closing the main window keeps the app running in the Windows tray or macOS menu bar. Fully quitting the app or shutting down the computer stops real-time local notifications and syncing. A daily WeChat digest is optional and requires your own ServerChan Turbo SendKey; assignment names and dates are sent through that service only if you enable it.

Daily email reminders are also optional. In **Settings → Reminders and sync**, connect your own Gmail address with a Gmail app password, send a test email to your recipient, then enable the daily schedule. The digest includes unfinished assignments, due dates, and source links. The app does not request your main Gmail password or require a hosted server. Gmail app passwords require eligible two-step verification; some school or work accounts restrict them. Outlook sending is not supported in this version because it requires a separate OAuth authorization integration. See [email reminder setup and limits](docs/email-reminders.md). Missed mail is sent only on the same day after the app resumes, with up to three attempts.

Backups include courses, cached assignments, notes, and ordinary settings. They exclude cookies, browser sign-in profiles, the SendKey, email sender authorization, and delivery history. On Mac, version 1.3.4 offers DMG and ZIP downloads for manual app replacement. Windows releases support in-app installation and restart.
