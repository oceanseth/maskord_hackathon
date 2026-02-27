import { useState, useEffect, useCallback } from 'react';

export interface VoiceSettings {
  /** 'vad' = auto-detect voice, 'ptt' = hold key to talk */
  mode: 'vad' | 'ptt';
  /** KeyboardEvent.code for push-to-talk, e.g. 'KeyV', 'Space' */
  pttKey: string;
  /** VAD sensitivity 0–100. Higher = requires louder audio to trigger */
  vadThreshold: number;
  /** Empty string = system default */
  inputDeviceId: string;
  outputDeviceId: string;
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

const STORAGE_KEY = 'maskord-voice-settings';

const DEFAULTS: VoiceSettings = {
  mode: 'vad',
  pttKey: 'KeyV',
  vadThreshold: 8,
  inputDeviceId: '',
  outputDeviceId: '',
};

function load(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore parse errors */ }
  return DEFAULTS;
}

export function useVoiceSettings() {
  const [settings, setSettings] = useState<VoiceSettings>(load);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(
        devices
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`,
          })),
      );
      setOutputs(
        devices
          .filter((d) => d.kind === 'audiooutput')
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label || `Speaker (${d.deviceId.slice(0, 8)}…)`,
          })),
      );
    } catch { /* permission not yet granted — will retry after join */ }
  }, []);

  // Re-enumerate when a device is plugged/unplugged
  useEffect(() => {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

  return { settings, updateSettings, refreshDevices, inputs, outputs };
}
