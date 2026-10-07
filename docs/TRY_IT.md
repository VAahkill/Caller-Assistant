# Try OpenCall on your Android phone (step by step, Windows)

By the end of this you'll have the assistant running on your Windows computer, the
OpenCall app on your Android phone, and a practice call where you play a caller and
hear your assistant answer. You don't need a phone line, a SIM or any paid service.

On a Mac or Linux, run the commands from the README's Quick start in a terminal
instead of the PowerShell ones below; from step 5 on, only the firewall step differs.

**What you need**
- A Windows 10 (version 22H2) or Windows 11 computer with 16 GB of memory (8 GB
  works if you use the free Groq option in step 4.4) and about 30 GB of free disk.
- An Android phone on the **same Wi-Fi** as the computer.
- One to two hours, most of it waiting for free downloads (about 12 GB in all).

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

**3.3 Change these lines in Notepad:**

| Line | Change it to |
|---|---|
| `OPENCALL_API_TOKEN=change-me` | `OPENCALL_API_TOKEN=` followed by the password you just copied |
| `OPENCALL_CALLER_LANGUAGES=` | the languages your callers speak, e.g. `OPENCALL_CALLER_LANGUAGES=en,hi,te` (Telugu) or `en,hi,ta` (Tamil) |

Leave everything else as it is. Save with **Ctrl+S** and close Notepad. Keep the
password handy: the app asks for it in step 7.

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

**4.2 Download the AI brain** (about 5 GB, once):

```powershell
docker compose exec ollama ollama pull llama3.1:8b
```

It ends with `success`.

**4.3 Wait until the assistant is ready.** The first time it starts, it also
downloads its voices and speech recognition (about 2 GB). Watch it with:

```powershell
docker compose logs -f opencall
```

It's ready when you see `Speech models loaded, ready for calls.` Lines that say
`Warning` or `FutureWarning` on the way are normal. Press **Ctrl+C** to stop
watching; the assistant keeps running. Later starts are ready in under a minute.

**4.4 Only if your computer has 8 GB of memory, or replies are very slow:** use
Groq's free tier instead of the local AI. It's free with no card.
1. Sign up at <https://console.groq.com>, open **API Keys**, and create a key.
2. In `.env`, change the three `OPENCALL_LLM_` lines to:

   ```
   OPENCALL_LLM_BASE_URL=https://api.groq.com/openai/v1
   OPENCALL_LLM_API_KEY=your-groq-key
   OPENCALL_LLM_MODEL=llama-3.3-70b-versatile
   ```

   If Groq has renamed that model, pick one from <https://console.groq.com/docs/models>.
   A bigger model also writes better Telugu and Tamil.
3. Apply it with `docker compose up -d`. You can skip step 4.2.

**4.5 Check from the computer.** Open <http://localhost:8000/health> in your
browser. It should show `{"ok":true, ...}`.

---

## Step 5. Let your phone reach the computer

**5.1 Find the computer's Wi-Fi address.**

```powershell
ipconfig
```

Under **Wireless LAN adapter Wi-Fi**, note the **IPv4 Address**, for example
`192.168.1.10`. (Mac: System Settings, Wi-Fi, Details. Linux: `hostname -I`.)

**5.2 Open port 8000 in Windows Firewall.** Open PowerShell **as administrator**
and run:

```powershell
New-NetFirewallRule -DisplayName "OpenCall" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

**5.3 Test it from the phone.** In the phone's browser, open
`http://192.168.1.10:8000/health` (with your address). You should see the same
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

---

## Step 7. Connect the app to the assistant

1. Open **OpenCall** and go to the **Settings** tab.
2. **Server address:** `http://192.168.1.10:8000` (your address from step 5.1,
   with `http://` and `:8000`).
3. **API token:** the password from step 3.2.
4. Tap **Connect**. It should say **Connected**. Allow notifications when asked.
5. Fill in your name and your assistant's name.
6. Tap **Voices** and press ▶ to hear each one, including Telugu and Tamil. Tap a
   voice to choose it.
7. Tap **Delivery location**, long-press your door on the map, and add landmarks.

---

## Step 8. Make a practice call

1. Go to the **Home** tab and tap **Try a practice call**, then **Start practice call**.
2. You'll hear your assistant answer. Its first reply to you can take up to a
   minute while the AI brain loads; after that it's a few seconds. Replies to
   speech take a little longer than replies to typed lines, because the computer
   first has to work out what you said.
3. Talk to it as a caller: tap one of the example lines, type and press **Send**,
   or tap 🎤, speak, and tap ■ when you're done (allow the microphone).
4. Things to try:
   - a delivery partner asking for directions, in Telugu or Tamil;
   - asking for an OTP (it refuses and alerts you);
   - asking something only you can answer, like "Is he free for dinner on
     Saturday?". A yellow card appears; tap **Answer** and type your reply;
   - leaving a message, then opening the **Calls** tab.
5. Tap **Hang up** when you're done.

---

## Every day after this

- Docker Desktop must be running. To start it with Windows: Docker Desktop,
  Settings, General, **Start Docker Desktop when you sign in**.
- Stop the assistant: `cd $HOME\Caller-Assistant` then `docker compose stop`.
- Start it again: `docker compose up -d`.
- Get a newer version: `git pull`, then `docker compose up -d --build`.

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
| `docker compose up` fails with `read-only file system` | Docker ran out of disk space. Check `Get-PSDrive C` shows at least 25 GB free (empty the Recycle Bin or run Disk Cleanup if not), run `wsl --shutdown`, reopen Docker Desktop, run `docker builder prune -af`, then `docker compose up -d --build` again. |
| The health page opens on the computer but not on the phone | Check the phone is on the same Wi-Fi (not mobile data or a guest network), the address and `:8000` are right, and you ran step 5.2. In Windows Settings, Network & internet, Wi-Fi, set your network to **Private**. |
| The app says `Server said: 401` | The token in the app doesn't match `OPENCALL_API_TOKEN` in `.env`. If you changed `.env` after starting, run `docker compose up -d`. |
| No sound in the practice call | Turn up the phone's media volume. |
| Replies take very long | Use Groq (step 4.4), or put `OPENCALL_WHISPER_MODEL=small` in `.env` and run `docker compose up -d`. |
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
