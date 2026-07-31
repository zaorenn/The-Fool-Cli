/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AudioDeviceSection from '@renderer/components/settings/SettingsModal/contents/voice/AudioDeviceSection';

const playTone = vi.fn().mockResolvedValue(undefined);
const setOutputDevice = vi.fn();
const captureStart = vi.fn().mockResolvedValue(undefined);
const captureStop = vi.fn();
let frameCallback: ((frame: { rms: number }) => void) | null = null;

vi.mock('@renderer/services/voice/AudioPlaybackService', () => ({
  AudioPlaybackService: class {
    public playTone = playTone;
    public setOutputDevice = setOutputDevice;
    public stop = vi.fn();
  },
}));

vi.mock('@renderer/services/voice/MicrophoneCapture', () => ({
  MicrophoneCapture: class {
    public start = captureStart;
    public stop = captureStop;
    public onFrame = (callback: (frame: { rms: number }) => void) => {
      frameCallback = callback;
    };
  },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const devices: MediaDeviceInfo[] = [
  { deviceId: 'mic-1', kind: 'audioinput', label: 'Headset microphone', groupId: 'g1' } as MediaDeviceInfo,
  { deviceId: 'spk-1', kind: 'audiooutput', label: 'Headset speakers', groupId: 'g1' } as MediaDeviceInfo,
];

beforeEach(() => {
  playTone.mockClear();
  setOutputDevice.mockClear();
  captureStart.mockClear();
  captureStop.mockClear();
  frameCallback = null;

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
      enumerateDevices: vi.fn().mockResolvedValue(devices),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

const setup = (overrides: Partial<React.ComponentProps<typeof AudioDeviceSection>> = {}) => {
  const onChange = vi.fn();
  render(
    <AudioDeviceSection
      devices={{ inputDeviceId: null, outputDeviceId: null }}
      volume={0.85}
      onChange={onChange}
      {...overrides}
    />
  );
  return { onChange };
};

describe('AudioDeviceSection', () => {
  it('lists the devices the machine actually has', async () => {
    setup();

    await waitFor(() => expect(screen.getByTestId('voice-input-device')).toBeTruthy());
    expect(screen.getByTestId('voice-output-device')).toBeTruthy();
  });

  it('plays a tone through the chosen speaker, so the choice can be heard', async () => {
    setup({ devices: { inputDeviceId: null, outputDeviceId: 'spk-1' } });

    fireEvent.click(screen.getByTestId('voice-output-test'));

    await waitFor(() => expect(setOutputDevice).toHaveBeenCalledWith('spk-1'));
    expect(playTone).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.85 }));
  });

  it('opens the chosen microphone and shows a live level', async () => {
    setup({ devices: { inputDeviceId: 'mic-1', outputDeviceId: null } });

    fireEvent.click(screen.getByTestId('voice-input-test'));

    await waitFor(() => expect(captureStart).toHaveBeenCalledWith('mic-1'));
    await waitFor(() => expect(screen.getByTestId('voice-input-level')).toBeTruthy());

    frameCallback?.({ rms: 0.2 });
    await waitFor(() => {
      const meter = screen.getByTestId('voice-input-level').firstElementChild as HTMLElement;
      expect(meter.style.width).not.toBe('0%');
    });
  });

  it('closes the microphone again when the test is stopped', async () => {
    setup({ devices: { inputDeviceId: 'mic-1', outputDeviceId: null } });

    fireEvent.click(screen.getByTestId('voice-input-test'));
    await waitFor(() => expect(captureStart).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('voice-input-test'));

    expect(captureStop).toHaveBeenCalled();
  });

  it('never leaves the microphone open behind a closed page', async () => {
    const { unmount } = render(
      <AudioDeviceSection devices={{ inputDeviceId: 'mic-1', outputDeviceId: null }} volume={0.5} onChange={vi.fn()} />
    );

    fireEvent.click(screen.getByTestId('voice-input-test'));
    await waitFor(() => expect(captureStart).toHaveBeenCalled());

    unmount();

    expect(captureStop).toHaveBeenCalled();
  });

  it('warns when microphone access is refused, rather than showing an empty list', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'));

    setup();

    await waitFor(() => expect(screen.getByText('settings.voice.microphoneBlocked')).toBeTruthy());
  });
});
