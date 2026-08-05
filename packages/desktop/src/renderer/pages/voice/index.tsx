import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Tag, Typography } from '@arco-design/web-react';
import { Check, CloseOne, Link, Magic, Microphone, PauseOne, SettingTwo, Voice } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { THEME_OVERRIDES_CONFIG_KEY, sanitizeThemeOverrides } from '@/common/config/themeOverrides';
import { useTalkToJester } from '@/renderer/hooks/assistant/useTalkToJester';
import { useFoolVoiceSettings } from '@/renderer/hooks/voice/useFoolVoiceSettings';
import { applyThemeOverrides } from '@/renderer/utils/theme/applyThemeOverrides';
import { RealtimeVoiceClient } from './RealtimeVoiceClient';
import { PcmAudioOutput, PcmMicrophone } from './pcmAudio';
import type { NormalizedRealtimeEvent, VoiceConversationPhase } from './realtimeProtocol';
import styles from './VoiceConversationPage.module.css';

type PagePhase = 'idle' | 'connecting' | VoiceConversationPhase | 'error';
type Activity = {
  id: string;
  label: string;
  detail: string;
  state: 'running' | 'completed' | 'failed';
};

const DEFAULT_ENDPOINT = 'ws://127.0.0.1:8765/v1/realtime';
const TONE_VARIABLES: Record<string, string | null> = {
  blue: '--arcoblue-6',
  violet: '--purple-6',
  teal: '--cyan-6',
  warm: '--orange-6',
  neutral: null,
};

const rgbToHex = (value: string): string | null => {
  const match = value.trim().match(/^(?:rgb\()?\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)?$/i);
  if (!match) return null;
  const channels = match.slice(1).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

const readSemanticColor = (variable: string): string | null =>
  rgbToHex(getComputedStyle(document.documentElement).getPropertyValue(variable));

const MODEL_OPTIONS = [
  { label: 'Qwen 3 (4B)', value: 'Qwen/Qwen3-4B-Instruct-2507' },
  { label: 'Qwen 3 (7B)', value: 'Qwen/Qwen3-7B-Instruct' },
  { label: 'Qwen 2.5 (3B)', value: 'Qwen/Qwen2.5-3B-Instruct' },
];

const VOICE_OPTIONS = [
  { label: 'Ultron (Custom Cloned)', value: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice' },
  { label: 'Female Voice 1', value: 'Qwen/Qwen3-TTS-12Hz-0.6B-Female1' },
  { label: 'Male Voice 1', value: 'Qwen/Qwen3-TTS-12Hz-0.6B-Male1' },
];

const VoiceConversationPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { settings } = useFoolVoiceSettings();
  const talkToJester = useTalkToJester();
  const [phase, setPhase] = useState<PagePhase>('idle');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [modelId, setModelId] = useState(MODEL_OPTIONS[0].value);
  const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].value);
  const [userTranscript, setUserTranscript] = useState('');
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const [error, setError] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]);
  const clientRef = useRef<RealtimeVoiceClient | null>(null);
  const microphoneRef = useRef<PcmMicrophone | null>(null);
  const outputRef = useRef(new PcmAudioOutput());

  const updateActivity = useCallback((id: string, patch: Partial<Activity>) => {
    setActivities((current) => {
      const existing = current.find((item) => item.id === id);
      if (!existing) {
        return [
          { id, label: patch.label ?? id, detail: patch.detail ?? '', state: patch.state ?? 'running' },
          ...current,
        ].slice(0, 8);
      }
      return current.map((item) => (item.id === id ? { ...item, ...patch } : item));
    });
  }, []);

  const runToolCall = useCallback(
    async (event: Extract<NormalizedRealtimeEvent, { kind: 'tool-call' }>) => {
      setPhase('acting');
      updateActivity(event.callId, {
        label: event.name,
        detail: t('settings.voice.conversationActionRunning'),
        state: 'running',
      });
      try {
        const args = JSON.parse(event.argumentsJson) as Record<string, unknown>;
        if (event.name === 'app.change_theme') {
          const tone = typeof args.tone === 'string' ? args.tone : '';
          const variable = TONE_VARIABLES[tone];
          const current = sanitizeThemeOverrides(configService.get(THEME_OVERRIDES_CONFIG_KEY));
          const colors = { ...current.colors };
          if (variable === null) {
            delete colors.primary;
          } else if (variable) {
            const color = readSemanticColor(variable);
            if (!color) throw new Error('Theme token is unavailable');
            colors.primary = color;
          } else {
            throw new Error('Unsupported theme tone');
          }
          const next = { ...current, colors };
          applyThemeOverrides(next);
          await configService.set(THEME_OVERRIDES_CONFIG_KEY, next);
          updateActivity(event.callId, {
            detail: t('settings.voice.conversationThemeChanged', { tone }),
            state: 'completed',
          });
        } else if (event.name === 'app.change_model' && typeof args.modelId === 'string') {
          setModelId(args.modelId);
          updateActivity(event.callId, {
            detail: t('settings.voice.conversationModelChanged', { model: args.modelId }),
            state: 'completed',
          });
        } else if (event.name === 'app.change_voice' && typeof args.voiceId === 'string') {
          setVoiceId(args.voiceId);
          updateActivity(event.callId, {
            detail: t('settings.voice.conversationVoiceChanged', { voice: args.voiceId }),
            state: 'completed',
          });
        } else if (event.name === 'app.ask_jester' && typeof args.request === 'string') {
          updateActivity(event.callId, {
            detail: t('settings.voice.conversationDelegated'),
            state: 'completed',
          });
          await talkToJester({ prompt: args.request });
        } else {
          // Assume any other tool call is an MCP tool
          const result = await ipcBridge.foolVoice.executeMcpTool.invoke({
            version: 1,
            requestId: crypto.randomUUID(),
            payload: {
              serverId: 'builtin-mcp-computer-use', // Hardcoded for now, or match from name if we had mapping
              toolName: event.name,
              args,
            }
          });
          
          if (!result.ok) {
            const err = (result as any).error;
            throw new Error(`MCP Tool error: ${err?.code || 'unknown'}`);
          }
          
          updateActivity(event.callId, {
            detail: t('settings.voice.mcpToolCompleted', { tool: event.name }),
            state: 'completed',
          });
          
          clientRef.current?.sendToolResult(event.callId, { ok: true, result: JSON.stringify(result.data.result) });
          setPhase('listening');
          return; // Early return since we sent result above
        }
        clientRef.current?.sendToolResult(event.callId, { ok: true });
        setPhase('listening');
      } catch (toolError) {
        const message = toolError instanceof Error ? toolError.message : String(toolError);
        clientRef.current?.sendToolResult(event.callId, {
          ok: false,
          error: message,
        });
        updateActivity(event.callId, {
          detail: message,
          state: 'failed',
        });
        setPhase('listening');
      }
    },
    [t, talkToJester, updateActivity]
  );

  const handleRealtimeEvent = useCallback(
    (event: NormalizedRealtimeEvent) => {
      switch (event.kind) {
        case 'phase':
          setPhase(event.phase);
          break;
        case 'user-transcript': {
          // Filter out filler words and wake words
          const filteredText = event.text.replace(/\b(eee|umm|hımm)\b/gi, '').replace(/wake up[,. ]*fool[,. ]*/gi, '').trim();
          setUserTranscript((current) => (event.final ? filteredText : `${current}${filteredText}`));
          if (event.final) setAssistantTranscript('');
          break;
        }
        case 'assistant-transcript':
          setAssistantTranscript((current) => (event.final ? event.text : `${current}${event.text}`));
          setPhase('speaking');
          break;
        case 'audio':
          setPhase('speaking');
          void outputRef.current.enqueue(event.pcm16Base64);
          break;
        case 'tool-call':
          void runToolCall(event);
          break;
        case 'error':
          setError(event.message);
          setPhase('error');
          break;
      }
    },
    [runToolCall]
  );

  const stop = useCallback(() => {
    microphoneRef.current?.stop();
    microphoneRef.current = null;
    clientRef.current?.disconnect();
    clientRef.current = null;
    outputRef.current.interrupt();
    setPhase('idle');
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError('');
    setPhase('connecting');
    try {
      const language = i18n.language.split('-')[0] || 'en';
      let connectionEndpoint = endpoint;
      if (endpoint === DEFAULT_ENDPOINT) {
        const runtime = await ipcBridge.foolVoice.ensureRealtime.invoke({
          version: 1,
          requestId: crypto.randomUUID(),
          payload: { modelId, voiceId },
        });
        if (runtime.ok === false) throw new Error(runtime.error.code);
        connectionEndpoint = runtime.data.endpoint;
      }
      const client = new RealtimeVoiceClient({ endpoint: connectionEndpoint, language, onEvent: handleRealtimeEvent });
      await client.connect();
      clientRef.current = client;
      const microphone = new PcmMicrophone();
      await microphone.start((audio) => client.appendAudio(audio), settings.devices.inputDeviceId);
      microphoneRef.current = microphone;
      setPhase('listening');
    } catch (startError) {
      stop();
      setError(startError instanceof Error ? startError.message : String(startError));
      setPhase('error');
    }
  }, [endpoint, handleRealtimeEvent, i18n.language, settings.devices.inputDeviceId, stop, modelId, voiceId]);

  const interrupt = useCallback(() => {
    outputRef.current.interrupt();
    clientRef.current?.interrupt();
    setPhase('listening');
  }, []);

  const active = phase !== 'idle' && phase !== 'error';
  const phaseLabel = useMemo(() => t(`settings.voice.conversationPhase.${phase}`), [phase, t]);

  return (
    <main className={classNames(styles.page, active && styles.active, styles[phase])} data-testid='voice-conversation'>
      <div className={styles.grid} />
      <div className='relative z-1 mx-auto flex h-full min-h-0 max-w-1440px flex-col px-24px py-20px'>
        <header className='flex flex-wrap items-center justify-between gap-12px'>
          <div className='flex items-center gap-10px'>
            <div className='flex size-34px items-center justify-center rounded-10px bg-primary-2 text-primary-6'>
              <Voice theme='filled' size={18} />
            </div>
            <div>
              <Typography.Title heading={5} className='!mb-0 !text-t-primary'>
                {t('settings.voice.conversationModeTitle')}
              </Typography.Title>
              <Typography.Text className='text-12px text-t-tertiary'>
                {t('settings.voice.conversationModeSubtitle')}
              </Typography.Text>
            </div>
          </div>
          <Tag icon={<Link size={13} />} color={active ? 'green' : 'gray'}>
            {phaseLabel}
          </Tag>
        </header>

        {error ? (
          <Alert className='mt-16px' type='error' content={error} closable onClose={() => setError('')} />
        ) : null}

        <div className='grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] items-center gap-28px max-[920px]:grid-cols-1 max-[920px]:overflow-auto'>
          <section className='flex min-w-0 flex-col items-center justify-center py-20px'>
            <div className={styles.orbStage} aria-label={phaseLabel}>
              <div className={styles.orbGlow} />
              <div className={styles.orbRing} />
              <div className={styles.orbCore} />
              <div className='relative z-2 flex flex-col items-center gap-5px text-center'>
                {phase === 'speaking' ? <Voice theme='filled' size={25} /> : <Microphone theme='outline' size={25} />}
                <span className='text-13px font-600 text-t-primary'>{phaseLabel}</span>
              </div>
            </div>

            <div className='min-h-72px max-w-620px text-center'>
              <Typography.Text className='block text-15px leading-24px text-t-secondary'>
                {assistantTranscript || userTranscript || t('settings.voice.conversationReadyHint')}
              </Typography.Text>
            </div>

            <div className='mt-14px flex flex-wrap items-center justify-center gap-10px'>
              {!active ? (
                <Button
                  type='primary'
                  size='large'
                  shape='round'
                  icon={<Microphone size={17} />}
                  onClick={() => void start()}
                >
                  {t('settings.voice.conversationStart')}
                </Button>
              ) : (
                <>
                  <Button shape='round' size='large' icon={<PauseOne size={17} />} onClick={stop}>
                    {t('settings.voice.conversationStop')}
                  </Button>
                  <Button shape='round' size='large' icon={<CloseOne size={17} />} onClick={interrupt}>
                    {t('settings.voice.conversationInterrupt')}
                  </Button>
                </>
              )}
            </div>

            {!active ? (
              <div className='mt-18px flex w-full max-w-520px flex-col gap-12px'>
                <div className='flex gap-12px'>
                  <Select
                    className='flex-1'
                    value={modelId}
                    onChange={setModelId}
                    options={MODEL_OPTIONS}
                    placeholder={t('settings.voice.conversationModel')}
                  />
                  <Select
                    className='flex-1'
                    value={voiceId}
                    onChange={setVoiceId}
                    options={VOICE_OPTIONS}
                    placeholder={t('settings.voice.conversationVoice')}
                  />
                </div>
                <Input
                  prefix={<SettingTwo size={14} />}
                  value={endpoint}
                  onChange={setEndpoint}
                  placeholder={DEFAULT_ENDPOINT}
                  aria-label={t('settings.voice.conversationEndpoint')}
                />
              </div>
            ) : null}
          </section>

          <aside className='flex min-h-0 flex-col rounded-18px border border-border-2 bg-bg-2/82 p-16px shadow-sm backdrop-blur-xl max-[920px]:mb-24px'>
            <div className='mb-14px flex items-center justify-between'>
              <div className='flex items-center gap-8px'>
                <Magic size={16} className='text-primary-6' />
                <Typography.Text className='font-600 text-t-primary'>
                  {t('settings.voice.conversationAgentActivity')}
                </Typography.Text>
              </div>
              <Tag size='small'>{activities.length}</Tag>
            </div>
            <div className={classNames(styles.timeline, 'min-h-260px flex-1 space-y-8px overflow-y-auto pb-20px')}>
              {activities.length === 0 ? (
                <div className='flex h-220px flex-col items-center justify-center text-center text-t-tertiary'>
                  <Magic size={26} className='mb-10px opacity-55' />
                  <Typography.Text className='max-w-230px text-12px leading-19px text-t-tertiary'>
                    {t('settings.voice.conversationActivityEmpty')}
                  </Typography.Text>
                </div>
              ) : (
                activities.map((activity) => (
                  <div key={activity.id} className='flex gap-9px rounded-12px bg-fill-1 px-10px py-10px'>
                    <span className='mt-1px flex size-20px shrink-0 items-center justify-center rounded-full bg-bg-3'>
                      {activity.state === 'completed' ? (
                        <Check size={12} className='text-success-6' />
                      ) : activity.state === 'failed' ? (
                        <CloseOne size={12} className='text-danger-6' />
                      ) : (
                        <span className='size-7px animate-pulse rounded-full bg-primary-6' />
                      )}
                    </span>
                    <div className='min-w-0'>
                      <Typography.Text className='block truncate text-12px font-600 text-t-primary'>
                        {activity.label}
                      </Typography.Text>
                      <Typography.Text className='mt-2px block text-11px leading-17px text-t-tertiary'>
                        {activity.detail}
                      </Typography.Text>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
};

export default VoiceConversationPage;
