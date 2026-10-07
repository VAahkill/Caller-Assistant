# Try OpenCall on your Android phone

This gets the assistant running on your computer and the app on your phone, then
lets you talk to the assistant with a practice call. You don't need a phone line,
a SIM or any paid service for this. Connecting real calls comes after (see
[TELEPHONY.md](TELEPHONY.md)).

You need:
- A computer (Windows, Mac or Linux) on the same Wi-Fi as your phone. 16 GB of
  memory is comfortable; an NVIDIA graphics card makes replies faster.
- An Android phone.
- About 15 GB of free disk space for the free speech and AI models.

## 1. Start the server on your computer

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (free for
   personal use) and [Git](https://git-scm.com/downloads).
2. Open a terminal (PowerShell on Windows) and run:

   ```bash
   git clone https://github.com/VAahkill/Caller-Assistant
   cd Caller-Assistant
   cp .env.example .env
   ```

   Until the first pull request is merged, add
   `-b claude/ai-reception-assistant-n4ffi3` to the `git clone` line.
3. Open `.env` in a text editor and change two lines:
   - `OPENCALL_API_TOKEN=` a long password of your own (letters and numbers). The app
     needs it to connect.
   - `OPENCALL_CALLER_LANGUAGES=` the languages your callers speak, for example
     `en,hi,te` or `en,ta`.
4. Start everything and download the AI model:

   ```bash
   docker compose up -d
   docker compose exec ollama ollama pull llama3.1:8b
   ```

   The first start downloads several GB. Check it's ready by opening
   `http://localhost:8000/health` in your computer's browser.
5. Find your computer's Wi-Fi address:
   - Windows: run `ipconfig` and look for "IPv4 Address" (like `192.168.1.10`).
   - Mac: System Settings, Wi-Fi, Details, "IP address".
   - Linux: run `hostname -I`.
6. If your computer has a firewall, allow incoming connections on port 8000.

No graphics card? Put `OPENCALL_WHISPER_MODEL=small` in `.env`. If replies are slow
or the Telugu and Tamil replies read badly, Groq's free tier runs a bigger model for
you (free key, no card); the lines to change are in `.env`.

## 2. Install the app

1. On your phone, download `OpenCall.apk` (from the project thread, or build it
   yourself, see below).
2. Open it. Android asks you to allow installing apps from your browser or file
   manager; allow it for this install. If Play Protect warns that the app is from an
   unknown developer, choose "Install anyway". The app isn't on the Play Store yet.

## 3. Connect the app

1. Open OpenCall and go to Settings.
2. Server address: `http://` + your computer's address + `:8000`, for example
   `http://192.168.1.10:8000`. Token: the password from step 1.3.
3. Tap Connect and allow notifications.
4. Fill in your name, pick a voice (tap ▶ to hear each one, including Telugu and
   Tamil), and pin your delivery location.

## 4. Make a practice call

On the Home tab, tap **Try a practice call**. You play someone calling you:
- tap one of the example lines, type, or tap 🎤, speak, and tap ■;
- the assistant answers out loud in its voice, and the transcript fills in;
- ask it something it can't know ("is he free on Saturday?") and you get the
  question to answer, just like during a real call.

Try a delivery partner in Telugu or Tamil, ask for an OTP, or leave a message, then
look at the Calls tab.

## Building the APK yourself

On a computer with Node 20+, JDK 17+ and the Android SDK:

```bash
cd mobile
npm install
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# the app is at android/app/build/outputs/apk/release/app-release.apk
```

## When something doesn't work

- **The app says it can't reach the server:** the phone and computer must be on the
  same Wi-Fi; check the address, `:8000`, and the computer's firewall.
- **No voice in the practice call:** turn the phone's media volume up.
- **Away from home:** install [Tailscale](https://tailscale.com/) (free) on both and
  use the computer's Tailscale address instead.
- **Background notifications:** the app notifies you while it's open or recently
  used. Notifications while it's fully closed need free Expo and Firebase accounts
  (`npx eas init`, then add Firebase push credentials) and a rebuilt app.
