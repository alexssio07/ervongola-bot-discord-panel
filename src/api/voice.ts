import { apiClient } from "./client";

export interface AudioFile {
  id: number;
  name: string;
  title: string;
  size: number;
}

export interface VoiceChannel {
  id: string;
  name: string;
  category: string | null;
  members: number;
}

export interface VoiceStatus {
  /** false se il bot non risponde (spento o in avvio). */
  available: boolean;
  /** false se il backend non ha un server di controllo del bot (BOT_CONTROL_URL): inutile riprovare. */
  configured?: boolean;
  connected: boolean;
  playing: boolean;
  channel_id?: string | null;
  channel_name?: string | null;
  now_playing?: string | null;
  error?: string | null;
}

export async function listAudioFiles(): Promise<AudioFile[]> {
  const res = await apiClient.get<{ files: AudioFile[] }>("/api/voice/audio");
  return res.data.files;
}

export async function getVoiceStatus(): Promise<VoiceStatus> {
  const res = await apiClient.get<VoiceStatus>("/api/voice/status");
  return res.data;
}

export async function listVoiceChannels(): Promise<VoiceChannel[]> {
  const res = await apiClient.get<{ channels: VoiceChannel[] }>("/api/voice/channels");
  return res.data.channels;
}

export async function connectVoice(channelId: string): Promise<void> {
  await apiClient.post("/api/voice/connect", { channel_id: channelId });
}

export async function disconnectVoice(): Promise<void> {
  await apiClient.post("/api/voice/disconnect");
}

export async function playAudio(file: string): Promise<void> {
  await apiClient.post("/api/voice/play", { file });
}

export async function stopAudio(): Promise<void> {
  await apiClient.post("/api/voice/stop");
}

/** Anteprima audio di una frase (mp3 generato dal bot, con cache lato server). */
export async function fetchPhraseAudio(text: string): Promise<Blob> {
  const res = await apiClient.post("/api/voice/tts", { text }, { responseType: "blob" });
  return res.data as Blob;
}

/** Scarica un audio dallo archivio del pannello, per l'ascolto in anteprima nel browser. */
export async function fetchAudioFile(name: string): Promise<Blob> {
  const res = await apiClient.get("/api/voice/audio/file", { params: { name }, responseType: "blob" });
  return res.data as Blob;
}
