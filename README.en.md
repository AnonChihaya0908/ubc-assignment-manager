# UBC Assignment Manager

A desktop app that brings PrairieLearn and UBC WeBWorK assignments, opening dates, due dates, and reminders into one place. The Windows app is the stable edition; the macOS app is a preview.

[Latest stable release](https://github.com/AnonChihaya0908/ubc-assignment-manager/releases/latest) · [Windows and macOS 1.3.0 preview](https://github.com/AnonChihaya0908/ubc-assignment-manager/releases/tag/v1.3.0) · [Report a problem](https://github.com/AnonChihaya0908/ubc-assignment-manager/issues) · [中文说明](README.md)

This is an independent project. It is not an official UBC, PrairieLearn, or WeBWorK app. It reads assignments visible to you after you sign in; it does not need a PrairieLearn API token.

## Install

**Windows:** Download the setup executable from the latest stable release and run it. The installer is per user. The portable ZIP also works, but extract the entire archive before opening the executable; the bundled runtime files are required. No separate Node.js installation or terminal command is needed.

**macOS preview:** Download the `macos-arm64.pkg` for Apple Silicon or `macos-x64.pkg` for Intel from the 1.3.0 preview release. The package installs a standalone `.app` in Applications. This preview is unsigned and unnotarized and has not yet completed first-install testing on a physical Mac. macOS may block the package or app. If you trust the release and want to proceed, try opening it once, then use **System Settings → Privacy & Security → Open Anyway**. Follow the system prompt. See [Apple’s guidance](https://support.apple.com/en-us/102445) for the current steps. You also need Microsoft Edge for course sign-in and syncing.

## First use

1. On first launch, paste your own student assignment list URL. PrairieLearn URLs end in `/pl/course_instance/<number>/assessments`; UBC WeBWorK URLs begin with `https://webwork.elearning.ubc.ca/webwork2/`.
2. Go to **Settings → Courses and login** and open the dedicated Edge sign-in window for each course. Sign in through your school account and leave the assignment page open.
3. Return to the app and select **Sync now** in the lower left. The dedicated Edge profile is separate from your everyday browser, so an existing browser login is not shared.
4. The app starts in your device language. Change it at **Settings → General and window → Display language**. Language changes do not change assignment dates, completion states, sign-in sessions, or other settings.

If PrairieLearn syncing fails, you can copy its assignment table from an already signed-in browser and use the manual import under Courses and login. WeBWorK must sync through the dedicated sign-in window. Newly installed copies do not contain another user’s courses. Imported or older courses must be confirmed before the app opens their pages, syncs them, or sends reminders.

## Reminders and data

Deadline notifications use the computer’s local time zone. Closing the main window keeps the app running in the Windows tray or macOS menu bar. Fully quitting the app or shutting down the computer stops real-time local notifications and syncing. A daily WeChat digest is optional and requires your own ServerChan Turbo SendKey; assignment names and dates are sent through that service only if you enable it.

Backups include courses, cached assignments, notes, and ordinary settings. They exclude cookies, the Edge sign-in profile, the SendKey, and delivery history. On Mac, updates are currently installed by downloading a new `.pkg`; Windows releases support in-app installation and restart.
