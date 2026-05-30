# CivicVox Omni Mobile

## Setup

```bash
cd mobile
npm install
cp .env.example .env
npm start
```

Set the gateway machine's LAN IP in `.env` so Expo Go can reach the backend:

```env
EXPO_PUBLIC_API_URL=http://192.168.x.x:8080
EXPO_PUBLIC_WS_URL=ws://192.168.x.x:8080/ws/stream
```

## Live Audio Flow

When an incident starts, the app records microphone audio with Expo. Before each WebSocket incident payload it:

1. Stops the current `.m4a` recording.
2. Sends `{ "type": "audio_start", "format": "m4a" }`.
3. Sends the base64 recording as an `audio_chunk`.
4. Sends `{ "type": "audio_commit" }`.
5. Sends the incident frame and starts the next recording.

The gateway transcribes the recording locally with Faster-Whisper. If Whisper is unavailable, the existing generic transcript fallback keeps the incident pipeline running.
