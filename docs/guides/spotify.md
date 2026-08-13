# Connecting Spotify

Connect Spotify and "play my favourite song" plays in the background, on the device your music already comes from. Without it, the same request opens the song in your default browser instead — which works, but it is a page opening rather than a song starting, and the assistant will say so.

## Table of Contents

- [What this changes](#what-this-changes)
- [What you need](#what-you-need)
- [Getting a client ID](#getting-a-client-id)
- [Connecting](#connecting)
- [Choosing what it may do](#choosing-what-it-may-do)
- [Connecting by voice](#connecting-by-voice)
- [What this app never does](#what-this-app-never-does)
- [Troubleshooting](#troubleshooting)

---

## What this changes

| You say                  | Not connected                    | Connected                                       |
| ------------------------ | -------------------------------- | ----------------------------------------------- |
| "Play my favourite song" | Opens it in your default browser | Plays on your active Spotify device             |
| "Put some music on"      | Opens a search page              | Starts playing, and names the track and speaker |

Neither route touches your mouse or your screen. Playing something never takes your pointer, never opens a window in front of what you were doing, and never takes a screenshot.

The assistant only says something is playing when Spotify has confirmed it started and named the device. If all that happened was a page opening, it says that instead — even if you would rather hear the other sentence.

## What you need

- A Spotify account. **Starting playback from another app requires Spotify Premium** — this is Spotify's restriction, not the app's. On a free account, connecting still works and the assistant can see what is playing, but asking it to start something will be refused and it will fall back to your browser.
- Spotify open somewhere — desktop app, phone, or web player. Spotify can only play on a device that is already running.
- A client ID of your own, which takes about two minutes to create (below).

## Getting a client ID

There is no client ID built into this app, on purpose. The app is not registered with Spotify, and shipping one that belonged to whoever built a copy would put everybody's playback under somebody else's account and rate limit. So it is yours.

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and log in with your ordinary Spotify account.
2. Click **Create app**. Give it any name and description — nobody but you sees them.
3. For **Redirect URIs**, add all three of these, one at a time:

   ```text
   http://127.0.0.1:8888/callback
   http://127.0.0.1:8889/callback
   http://127.0.0.1:8890/callback
   ```

   These are also shown in Settings → Connections, where you can copy each one.

4. Tick **Web API**, accept Spotify's terms, and save.
5. Open the app you just created, click **Settings**, and copy the **Client ID**.

> **Why three.** Spotify matches the redirect address exactly, character for character, against what you registered — so the app cannot use a port picked at random. It listens on 8888, and falls back to 8889 and then 8890 if something else on your machine is already using one. Registering all three once means a busy port costs you nothing.

**Do not copy the client _secret_.** This app never asks for one and has nowhere to put it. It signs in with PKCE, which is the flow designed so that a desktop app does not need a secret — a secret shipped inside an application anybody can download is not a secret.

## Connecting

1. Open **Settings → Connections**.
2. Paste your client ID into the **Client ID** field. It is saved when you click away from it.
3. Click **Connect**.
4. Your own browser opens Spotify's own sign-in page. **You sign in there**, with your own password manager, on a page whose address bar tells you it is Spotify.
5. Approve the permissions Spotify asks about. The tab tells you when it is done and can be closed.

Settings → Connections then shows the connected account.

To disconnect, click **Disconnect**. The stored connection is deleted, and every permission you granted is withdrawn with it.

## Choosing what it may do

Connecting an account and allowing something to be done in it are separate answers. The switches under **What it may do** are per capability, and they start off matching what the sign-in itself asked for:

| Switch                | What it allows                                                                     |
| --------------------- | ---------------------------------------------------------------------------------- |
| See what is playing   | Reading the current track and your device list                                     |
| Play, pause and skip  | Starting and controlling playback — this is the one "play my favourite song" needs |
| Search your library   | Finding a song by name in your library                                             |
| Add to your playlists | Changing something you keep                                                        |

Turn **Play, pause and skip** off and the assistant goes back to opening songs in your browser, even while connected.

## Connecting by voice

You can also ask out loud — but the assistant asks you first, and opens nothing until you have said yes:

> **You:** Can you play my favourite song on Spotify?
> **The Fool:** Spotify isn't connected yet. Would you like to connect it?
> **You:** Yes.
> — _your browser opens on Spotify's sign-in page, and you sign in there._

If you have not entered a client ID yet, it will tell you to do that in Settings → Connections first, rather than opening a sign-in that cannot succeed.

## What this app never does

These are guarantees enforced in code, not preferences:

- **It never sees your password.** There is no login form anywhere in this application, and no code path that types a credential.
- **It never asks you for a password, a code, or a token in conversation**, and it will refuse one if you offer it.
- **It never drives the sign-in window.** Once your browser is open on Spotify's page, the assistant does not look at it, click in it, or type into it. That window is yours.
- **It never opens a sign-in you did not agree to.** Asking is a separate step from connecting.
- **Your token never reaches the part of the app that runs model output.** It is kept by the main process, in a file readable only by your user account, and is never handed to the interface or to any assistant.

## Troubleshooting

**"That does not look like a Spotify client ID."**
A client ID is 32 characters of lowercase hex. You have most likely copied the client secret, or copied only part of the ID.

**The browser says `INVALID_CLIENT: Invalid redirect URI`.**
One of the three redirect URIs is missing from your dashboard, or has a typo. They must match exactly — `127.0.0.1` rather than `localhost`, `http` rather than `https`, and the `/callback` path. Copy them from Settings → Connections rather than typing them.

**Connecting fails immediately, before the browser opens.**
All three ports are in use by something else. Close whatever is holding 8888–8890, or register a different port and change it in the app.

**"Spotify is not open anywhere."**
Spotify can only play on a running device. Open Spotify on your computer or phone and ask again.

**It opens a page in the browser instead of playing.**
One of: Spotify is not connected, the **Play, pause and skip** switch is off, the account is not Premium, or nothing is open to play on. The assistant will say which — and it will say it opened a page rather than claiming the song is playing.

**It says it played something but you hear nothing.**
Check the device it named. Playback starts on your active Spotify device, which may be a phone in another room.
