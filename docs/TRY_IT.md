# Try OpenCall on your Android phone (step by step, Windows)

By the end of this you'll have the assistant running on your Windows computer, the
OpenCall app on your Android phone, and a practice call where you play a caller and
hear your assistant answer. You don't need a phone line, a SIM or any paid service.

On a Mac or Linux, run the commands from the README's Quick start in a terminal
instead of the PowerShell ones below; from step 5 on, only the firewall step differs.

**Already running the first version?** Skip to
[Updating from the first version](#updating-from-the-first-version).

**What you need**
- A Windows 10 (version 22H2) or Windows 11 computer with 16 GB of memory (8 GB
  works if you use the free Groq option in step 4.4) and about 30 GB of free disk
  (it can be a second drive such as D:, see step 2.6).
- An Android phone on the **same Wi-Fi** as the computer.
- One to two hours, most of it waiting for free downloads (about 13 GB in all).

Every command below goes into **Windows PowerShell**: press the Windows key, type
`powershell`, press Enter. Copy a command, paste it with a right-click, press Enter.

---

## Step 1. Get the right copy of the code

The finished app lives on a separate branch until the pull request is merged. A
plain `git clone` gets the main branch, which only has a README. That's why
`.env.example` wasn't found.

**1.1 Remove the two copies you already made.** Both are empty, so nothing is lost.

```powershell
cd $HOME
Remove-Item -Recurse -Force .\Caller-Assistant
```

This also removes the second copy inside it. If PowerShell says a file is in use,
close any File Explorer window or editor open in that folder and run it again.

**1.2 Download the branch with the app.**

```powershell
git clone --branch claude/ai-reception-assistant-n4ffi3 --config core.autocrlf=false https://github.com/VAahkill/Caller-Assistant
cd Caller-Assistant
```

The `git clone` line is one command, even if it wraps onto two lines on your
screen. `core.autocrlf=false` keeps the files exactly as they are on GitHub, which
the Linux containers in step 4 expect.

**1.3 Check you have it.**

```powershell
Test-Path .env.example
```

It should print `True`. Running `dir` should show `backend`, `mobile`, `docs` and
`docker-compose.yml`.

Once the pull request is merged, a plain
`git clone https://github.com/VAahkill/Caller-Assistant` is enough.

---

## Step 2. Install Docker Desktop

Docker runs the assistant and its AI models in containers, so you don't install
Python or the models yourself. It's free for personal use.

1. Download **Docker Desktop for Windows** from
   <https://www.docker.com/products/docker-desktop/> and run the installer.
2. Keep **"Use WSL 2 instead of Hyper-V"** ticked. Restart when it asks.
3. Open Docker Desktop from the Start menu, accept the terms, and skip signing in
   (no account needed). Wait until the bottom-left corner says **Engine running**.
4. Check it in a new PowerShell window:

   ```powershell
   docker version
   docker compose version
   ```

   Both should print version numbers, with a **Server** section in the first one.

If Docker Desktop shows an error instead of **Engine running**, or `docker version`
says `Docker Desktop is unable to start`:

- **"Virtual Machine Platform not enabled"** or **"WSL needs updating"**: open
  PowerShell **as administrator** (Windows key, type `powershell`, right-click
  **Windows PowerShell**, **Run as administrator**, **Yes**) and run:

  ```powershell
  Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
  wsl --update
  ```

  Answer `N` if it offers to restart, then restart Windows from the Start menu.
  Restarting only Docker Desktop isn't enough. A normal (not administrator)
  PowerShell answers these commands with `requires elevation`.
- **Still the same error after the restart, or "No virtualization available"**:
  open Task Manager (**Ctrl+Shift+Esc**), **Performance**, **CPU**, and look at
  **Virtualization** below the graph.
  - **Disabled**: it's switched off in the BIOS. Open Settings, System, Recovery,
    click **Restart now** next to Advanced startup, then choose Troubleshoot,
    Advanced options, **UEFI Firmware Settings**, Restart. Set **Intel
    Virtualization Technology** (VT-x), or **SVM Mode** on AMD, to **Enabled**
    (usually under Advanced or CPU Configuration), then save and exit (usually F10).
  - **Enabled**: press the Windows key, open **Turn Windows features on or off**,
    tick **Virtual Machine Platform** and **Windows Subsystem for Linux**, click
    OK and restart.

  Then click **Recheck and retry** in Docker Desktop.

5. **On a 16 GB computer, give Docker more memory.** Windows lets Docker use half
   your memory, which is tight for the local AI. Run these two lines once:

   ```powershell
   Set-Content -Path "$HOME\.wslconfig" -Value "[wsl2]`nmemory=12GB"
   wsl --shutdown
   ```

   Docker Desktop then says it stopped: click **Restart** (or reopen it) and wait for
   **Engine running** again. Skip this on an 8 GB computer and use Groq in step 4.4.

6. **If drive C: has less than 30 GB free but another drive has room**, keep Docker's
   downloads there. Make a folder, for example with
   `New-Item -ItemType Directory D:\DockerData`. Then in Docker Desktop click the
   gear (top right), **Resources**, **Advanced**, and under **Disk image location**
   click **Browse**, pick that folder and click **Apply & restart**. Wait for
   **Engine running** again.

---

## Step 3. Fill in your settings

**3.1 Create your settings file and open it in Notepad.**

```powershell
cd $HOME\Caller-Assistant
Copy-Item .env.example .env
notepad .env
```

**3.2 Make a password for the app.** In PowerShell (not Notepad), run:

```powershell
-join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
```

Copy the 32 letters and numbers it prints.

**3.3 Change one line in Notepad:** replace `OPENCALL_API_TOKEN=change-me` with
`OPENCALL_API_TOKEN=` followed by the password you just copied.

Leave everything else as it is. You choose your callers' languages in the app, in
step 7. Save with **Ctrl+S** and close Notepad. Keep the password somewhere safe; the
app can pair without it (step 7), but it's your way in if pairing doesn't work.

---

## Step 4. Start the assistant

**4.1 Build and start it.** The first time, this downloads about 5 GB and takes 15
to 45 minutes depending on your internet. Later starts take seconds.

```powershell
docker compose up -d --build
```

When it finishes, check both parts are running:

```powershell
docker compose ps
```

You should see `opencall` and `ollama`, both **running** (or **Up**).

**4.2 The AI brain downloads by itself** the first time (Qwen3 4B, about 2.5 GB,
chosen because it handled the most test calls correctly of the free models that fit
in 16 GB). To watch it:

```powershell
docker compose logs -f ollama
```

It's done when a line says `success`. Press **Ctrl+C** to stop watching.

**4.3 Wait until the assistant is ready.** The first time it starts, it also
downloads its voices, speech recognition for English, Telugu, Tamil and Hindi, and
translation (about 5 GB). Watch it with:

```powershell
docker compose logs -f opencall
```

Lines like `Preparing the vasista22/whisper-telugu-small speech model` are the
one-time downloads. It's ready when you see `Speech models loaded, ready for calls.`
Lines that say `Warning` or `FutureWarning` on the way are normal. Press **Ctrl+C** to
stop watching; the assistant keeps running. Later starts are ready in a minute or two.

**4.4 Only if your computer has 8 GB of memory, or replies are very slow:** use
Groq's free tier instead of the local AI. It's free with no card, but what callers
say then goes to Groq to be answered, so it's less private than the local AI.
1. Sign up at <https://console.groq.com>, open **API Keys**, and create a key.
2. In `.env`, change the `OPENCALL_LLM_` lines to these four (remove the `#` at the
   start of each):

   ```
   OPENCALL_LLM_BASE_URL=https://api.groq.com/openai/v1
   OPENCALL_LLM_API_KEY=your-groq-key
   OPENCALL_LLM_MODEL=openai/gpt-oss-20b
   OPENCALL_LLM_EXTRA_BODY={"reasoning_effort": "low"}
   ```

   If Groq has renamed that model, pick one from <https://console.groq.com/docs/models>.
   `.env` also has the lines for Google Gemini's free tier, another option.
3. Apply it with `docker compose up -d`. The local AI brain then isn't downloaded.

**4.5 Check from the computer.** Open <http://localhost:8000/health> in your
browser. It should show `{"ok":true, ...}`.

---

## Step 5. Let your phone reach the computer

**5.1 Find the computer's Wi-Fi address.**

```powershell
ipconfig
```

Under **Wireless LAN adapter Wi-Fi**, note the **IPv4 Address**, such as
`192.168.1.7`. This is **your address**: everywhere below that says
`YOUR-ADDRESS`, type these numbers instead. (Mac: System Settings, Wi-Fi, Details.
Linux: `hostname -I`.)

**5.2 Open port 8000 in Windows Firewall.** Open PowerShell **as administrator**
and run:

```powershell
New-NetFirewallRule -DisplayName "OpenCall" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

**5.3 Test it from the phone.** In the phone's browser, open
`http://YOUR-ADDRESS:8000/health`, for example `http://192.168.1.7:8000/health`.
You should see the same
`{"ok":true, ...}`. If it doesn't load, see "Something's not working" below before
going on.

---

## Step 6. Install the app on your phone

1. Get **OpenCall.apk** onto the phone. Either download it from the project thread
   in the Claude app on your phone, or download it on the computer and copy it over
   with a USB cable (phone in "File transfer" mode, drop it in `Download`) or via
   Google Drive.
2. On the phone, open the **Files** app, go to **Downloads**, and tap
   **OpenCall.apk**.
3. Android says it can't install apps from this source: tap **Settings**, turn on
   **Allow from this source**, go back, and tap **Install**.
4. If Play Protect warns about an unknown app, tap **More details**, then
   **Install anyway**. It isn't on the Play Store yet, which is why Android asks.

If the phone says **App blocked by Advanced Protection**, Android's Advanced
Protection is on. It only blocks installing by tapping an APK on the phone, so
install it from your computer over the USB cable instead (6.1). That's free and
Advanced Protection can stay on. If that fails, turn protection off just for the
install (6.2).

**6.1 Install from your computer over USB.**

1. Get **OpenCall.apk** onto the computer: open the project thread in the Claude app
   or at claude.ai on the computer and download it into your **Downloads** folder.
2. Download Google's free Android tools and copy the app next to them. Paste these
   into PowerShell one line at a time:

   ```powershell
   cd $HOME
   $ProgressPreference = 'SilentlyContinue'
   Invoke-WebRequest https://dl.google.com/android/repository/platform-tools-latest-windows.zip -OutFile platform-tools.zip -UseBasicParsing
   Expand-Archive platform-tools.zip -DestinationPath . -Force
   cd platform-tools
   Copy-Item $HOME\Downloads\OpenCall.apk .
   ```

3. On the phone, turn on USB debugging:
   1. Settings, **About device**, **Version**, then tap **Build number** seven times
      and enter your PIN. It says you're now a developer.
   2. In Settings, search for `USB debugging` (it's inside **Developer options**)
      and turn it on.
4. **Unlock the phone**, then plug it into the computer with the USB cable. Advanced
   Protection treats a cable plugged into a locked phone as charge-only; if the phone
   says to unlock and reconnect, unplug and plug in again while it's unlocked.
5. In PowerShell run:

   ```powershell
   .\adb devices
   ```

   The phone asks **Allow USB debugging?** Tick **Always allow from this computer**
   and tap **Allow**. Run `.\adb devices` again: you should see one line ending in
   `device`.
6. Install the app:

   ```powershell
   .\adb install OpenCall.apk
   ```

   Wait for `Success`. If the phone shows a Play Protect message, choose **Install**
   (or **Scan app**), not Cancel. OpenCall is now in your app list.
7. You can turn **USB debugging** off again. To install a newer OpenCall later, copy
   the new APK into the `platform-tools` folder, turn USB debugging on, and run
   `.\adb install -r OpenCall.apk` (the `-r` keeps your settings).

If something goes wrong in 6.1:

| What you see | What to do |
|---|---|
| `adb devices` shows nothing | Try another cable (some only charge) and another USB port. Swipe down on the phone, tap the USB notification and pick **File transfer**. |
| The line ends in `unauthorized` | Unlock the phone and tap **Allow** on the message. If it never appears, turn USB debugging off and on, then unplug and plug in again. |
| `INSTALL_FAILED_VERIFICATION_FAILURE` | Run `.\adb push OpenCall.apk /data/local/tmp/o.apk` and then `.\adb shell pm install -r /data/local/tmp/o.apk`. |
| `INSTALL_FAILED_USER_RESTRICTED` | The phone refuses installs from the computer. Use 6.2. |
| No cable works | In Developer options open **Wireless debugging** (phone and computer on the same Wi-Fi), turn it on and tap **Pair device with pairing code**. Run `.\adb pair` followed by the address and port it shows (like `192.168.1.5:37123`) and type the code. Then run `.\adb connect` with the address and port shown on the Wireless debugging screen itself, which is a different port, and then `.\adb install OpenCall.apk`. |

**6.2 Or turn Device protection off for the install.** Advanced Protection has two
separate switches, one on your Google account and one on the phone, and both must be
off:

1. In Settings, search for `Advanced Protection` (or open Settings, Google, All
   services, Advanced Protection) and turn off **Device protection**. Restart if
   asked.
2. Make sure no Google account signed in on the phone is still enrolled in the
   Advanced Protection Program (check each at <https://myaccount.google.com>,
   Security).
3. In Settings, Apps, Google Play Store, tap **Force stop**, then **Storage usage**,
   **Clear cache**. Restart the phone and tap the APK again. If it asks again to
   allow installs from Files, allow it.
4. Once OpenCall is installed, you can turn **Device protection** back on. While
   it's on, Android won't install updates to OpenCall from an APK, so use 6.1 for
   those, or switch it off again.

"Scan apps with Play Protect" stays greyed out until this clears, which Google says
can take up to 24 hours after leaving the account program.

---

## Step 7. Set up the app

Open **OpenCall**. It walks you through setup, one screen at a time; you can change
everything later.

1. **Connect to your server.** Type `http://YOUR-ADDRESS:8000` (your address from
   step 5.1, with `http://` before it and `:8000` after it). Then pair the phone, so
   you don't have to type the long password:
   1. Tap **Pair with code**, then **Get a code**.
   2. On the computer, run:

      ```powershell
      docker compose logs opencall | Select-String "Pairing code"
      ```

      The last line shows a 6-digit code, valid for 5 minutes.
   3. Type it on the phone and tap **Pair**. It says **Connected**.

   Or paste the password from step 3.2 into **Access token** and tap **Connect**.
2. **You and your assistant.** Your name and your assistant's name, which callers
   hear when it picks up.
3. **Country and languages.** Leave the country as India (+91): it's how the
   assistant tells local calls from international ones. Tap the languages your
   callers speak, most common first, such as Telugu, Hindi, English. The assistant
   works out which one each caller is speaking.
4. **Let your contacts through.** Tap **Sync contacts** and allow access, so saved
   contacts always get through.
5. **Choose a voice.** Tap ▶ to hear each one (tap again to stop) and pick one for
   each language. **Use your own voice** records 15 seconds of you; it plays back
   so you can check it, and appears under **My voices**. Without an NVIDIA graphics
   card the computer speaks a recorded voice far too slowly for a live call, so keep
   a built-in voice for calls for now.
6. Allow notifications when asked.

Afterwards, the **Assistant** tab has the rest: **Delivery location** (long-press
your door on the map, or paste a Google Maps link, then add landmarks),
**Instructions** (how to handle calls, with ready-made examples), **What callers may
know**, **Who gets through** and **Away**.

---

## Step 8. Make a practice call

1. On the **Today** tab, tap **Practice call**, pick the language you'll speak as the
   caller (or leave it on **Auto**), and tap **Start practice call**.
2. You'll hear your assistant answer. The first reply after the computer starts can
   take a while as the AI brain loads; then replies take a few seconds. If it needs a
   moment it says "One moment, please" so the caller knows it's there.
3. Talk to it as a caller: tap one of the example lines, type and press **Send**,
   or tap 🎤, speak, and tap ■ when you're done (allow the microphone). Each line
   shows in the transcript, with a translation into your language when the caller
   speaks another one.
4. Things to try:
   - a delivery partner asking for directions, in Telugu or Tamil;
   - asking for an OTP or a bank balance (it refuses and alerts you);
   - asking something only you can answer, like "Is he free for dinner on
     Saturday?". A card appears; type your answer in your own language and it's
     translated and spoken to the caller;
   - leaving a message, then opening the **Inbox** tab.
5. Tap **Hang up** when you're done.

---

## Every day after this

- Docker Desktop must be running. To start it with Windows: Docker Desktop,
  Settings, General, **Start Docker Desktop when you sign in**.
- Stop the assistant: `cd $HOME\Caller-Assistant` then `docker compose stop`.
- Start it again: `docker compose up -d`.
- Get a newer version: `git pull`, then `docker compose up -d --build`.

## Updating from the first version

If you already ran the first version, you keep your calls, contacts and settings.

1. Update the code and free the space the old AI brain used (about 5 GB):

   ```powershell
   cd $HOME\Caller-Assistant
   git pull
   docker compose exec ollama ollama rm llama3.1:8b
   ```

2. Open `.env` with `notepad .env` and change `OPENCALL_LLM_MODEL=llama3.1:8b` to
   `OPENCALL_LLM_MODEL=qwen3:4b-instruct`. Save and close. (If you use Groq, change
   its lines as in step 4.4 instead.)
3. Rebuild and start it. This downloads about 8 GB the first time (step 4.2 and 4.3
   say what to watch for):

   ```powershell
   docker compose up -d --build
   ```

4. Install the new app over the old one from the `platform-tools` folder (USB
   debugging on, as in step 6.1). Your server address and token stay:

   ```powershell
   cd $HOME\platform-tools
   Copy-Item $HOME\Downloads\OpenCall.apk . -Force
   .\adb install -r OpenCall.apk
   ```

5. In the app, open **Assistant**, **Languages**, and tap your callers' languages.
   The `OPENCALL_CALLER_LANGUAGES` line in `.env` isn't used any more.

## Real phone calls

Practice calls work on Windows. Answering your real calls needs the Bluetooth link
or the GSM modem described in [TELEPHONY.md](TELEPHONY.md), and both currently need
a Linux computer, such as an old laptop or a Raspberry Pi, because Windows doesn't
let Docker use the computer's Bluetooth or USB modem.

## Something's not working

| What you see | What to do |
|---|---|
| `docker : The term 'docker' is not recognized` | Docker Desktop isn't installed yet, or PowerShell was open before you installed it. Close PowerShell and open a new one. |
| `error during connect` or `cannot find the file specified` mentioning `docker_engine` | Docker Desktop isn't running. Open it and wait for "Engine running". |
| `docker compose up` stops with a download error | Run the same command again; it carries on where it stopped. |
| `docker compose up` fails with `read-only file system` | Docker ran out of disk space. Free space on C: (Recycle Bin, Disk Cleanup) or move Docker's data to another drive (step 2.6), run `wsl --shutdown`, reopen Docker Desktop, run `docker builder prune -af`, then `docker compose up -d --build` again. |
| Docker Desktop shows `dockerd configuration error` or `/usr/local/bin/dockerd: no such file or directory` | Docker's internal system is damaged, often after the disk filled up. Click **Reset dockerd configuration**; if that doesn't help, **Quit**, run `wsl --shutdown` and reopen it; if it still fails, use **Troubleshoot** (bug icon), **Reset to factory defaults**, then set the disk image location again (step 2.6) before rebuilding. |
| The health page opens on the computer but not on the phone | Check the phone is on the same Wi-Fi (not mobile data or a guest network), you used your own address from `ipconfig` (not the example), `:8000` is there, and you ran step 5.2. In Windows Settings, Network & internet, Wi-Fi, set your network to **Private**. |
| The app says `Server said: bad token` or `The server didn't accept the token` | The app reached the server but the token doesn't match. Paste it into the app again instead of typing it (step 7). To see the token the server is using, run `docker compose exec opencall printenv OPENCALL_API_TOKEN`. If that isn't the one in `.env` (for example it says `change-me`), save `.env` and run `docker compose up -d --force-recreate opencall`. |
| The app says `Couldn't reach` | Check the address starts with `http://` (not `https://`), uses your own address from step 5.1 and ends in `:8000`, and that the health page from step 5.3 opens on the phone. |
| No sound in the practice call | Turn up the phone's media volume. |
| The app's pairing says the code didn't match or ran out | Tap **Ask for a new code** and run the `Select-String` command from step 7 again; use the last code it shows. |
| The log says `Couldn't pull qwen3:4b-instruct` | Check the internet connection and run `docker compose restart ollama`. |
| Replies take very long | Close other big programs, check Docker has 12 GB (step 2.5), or use Groq (step 4.4). |
| Anything else | Run `docker compose logs --tail 100 opencall` and send the output in the project thread. |

Notifications arrive while the app is open or recently used. Getting them while it's
fully closed needs free Expo and Firebase accounts and a rebuilt app.

## Building the app yourself (optional)

The APK in the thread is already built. To build your own, you need Node 20+,
JDK 17+ and the Android SDK (Android Studio installs the last two):

```powershell
cd $HOME\Caller-Assistant\mobile
npm install
npx expo prebuild --platform android
cd android
.\gradlew.bat assembleRelease
```

The app is then at `android\app\build\outputs\apk\release\app-release.apk`. On Mac
or Linux, run `./gradlew assembleRelease` instead of the last line.
