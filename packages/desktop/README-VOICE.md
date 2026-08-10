# The Fool - Sesli Asistan Sistemi

## 🎯 Özellikler

### Speech-to-Text (STT) Motorları

#### Whisper Turbo (Varsayılan)
```typescript
// Hızlı transkripsiyon için ideal (~93 tokens/saniye)
await foolVoice.initSTT('whisper-turbo');

// Desteklenen özellikler:
// - 98 dil desteği
// - 13 ses kategorisi (ıslık, köpek havlaması vb.)
// - ~750MB model boyutu
```

#### Whisper Large-v3 (Yüksek Doğruluk)
```typescript
await foolVoice.initSTT('whisper-large-v3');

// Özellikler:
// - En yüksek doğruluk (%98+)
// - ~40 tokens/saniye hızı
// - 2.5GB model boyutu
```

### Text-to-Speech (TTS) Motorları

#### Piper (En Hızlı) ⚡
```typescript
await foolVoice.initTTS('piper-en-libritts-r');

// Performans:
// - ~82ms cümle başına
// - Doğal ses tonu
// - 180MB model boyutu
// - Yüksek doğruluk
```

#### Kokoro (En Doğal) 🎭
```typescript
await foolVoice.initTTS('kokoro-common_voice-v3');

// Özellikler:
// - ~50ms/saniye hızı
// - 20+ ön eğitimli ses
// - 500MB model boyutu
// - En yüksek kalite
```

#### Kitten (En Küçük) 📦
```typescript
await foolVoice.initTTS('kitten-v1-small');

// Özellikler:
// - ~50MB model boyutu
// - Hızlı başlatma
// - Temel kalite
```

### Wake Word Sistemi

#### Standart Wake Words
- `FOOL` (varsayılan)
- `Hey Fool`
- `Assistant`

#### Custom Wake Word Modeli
```typescript
await foolVoice.loadWakeWordModel('/path/to/model');
```

## 📊 Performans Metrikleri

### STT (Speech-to-Text)
| Motor | Hız | Doğruluk | Bellek | Diller |
|-------|-----|----------|--------|-------|
| Turbo | 93 tok/s | %95 | 750MB | 98+ |
| Large-v3 | 40 tok/s | %98+ | 2.5GB | 98+ |

### TTS (Text-to-Speech)
| Motor | Hız/Kalite | Bellek | Ses Tonu |
|-------|-----------|--------|----------|
| Piper | ~82ms/cümle | 180MB | Yüksek |
| Kokoro | ~50ms/cümle | 500MB | Çok Doğal |
| Kitten | ~120ms/cümle | 50MB | Temel |

## 🔌 IPC API Kullanımı

```typescript
// Voice sistemi başlatma
const voice = window.foolVoice;

await voice.initSTT('whisper-turbo');
await voice.initTTS('piper-en-libritts-r');

// Ses dinleme modunu başlat
const transcription = await voice.startListening({ autoStartTTS: false });

// Transkripsiyon sonucu
console.log(transcription.text);
console.log(transcription.language);
console.log(transcription.segments);

// Metin okuma
await voice.speak("Merhaba, size nasıl yardımcı olabilirim?", {
  speed: 1.0,
  volume: 80,
});

// Voice durumu kontrolü
const state = voice.getState();
console.log(state.isListening); // true/false
```

## 🛠️ Geliştirici İpuçları

### Dinamik Ses Ayarları
```typescript
await voice.configure({
  sttEngine: 'whisper-turbo',
  ttsEngine: 'piper-en-libritts-r',
  volume: 80,
  speed: 1.0,
});
```

### Voice State Listener'ı
```typescript
const unsubscribe = voice.onVoiceStateChange((state) => {
  if (state.isListening) {
    console.log('🎤 Dinleniyor...');
  }
  if (state.isSpeaking) {
    console.log('🗣️ Konuşuyoruz...');
  }
});
```

### Transcription Segmentleri
```typescript
// Her bir segment için işleme
transcription.segments.forEach((segment, index) => {
  console.log(`[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}]: ${segment.text}`);
});
```

## 🎯 Kullanım Senaryoları

### 1. Kod Genişletme İçin Sesli Komut
```typescript
// "Generate a TypeScript utility to validate user input"
await voice.startListening();
// ... transcribe ...
await generateCode(transcription.text);
await voice.speak("İşte istediğiniz utility fonksiyonu");
```

### 2. Kod Açıklama
```typescript
// "Explain this code" + kod dosyasını seçme
await readFile(filePath);
await explainCode(fileContent, transcription.text);
await voice.speak(KOD_AÇIKLAMASI);
```

### 3. Debug Yardım
```typescript
// "Show me the error in console.log"
await voice.startListening();
// ... transcribe ...
await showDebugInfo(transcription.text);
await voice.speak("Hata logunu gösteriyorum");
```

## 📈 Optimizasyon İpuçları

### Bellek Kullanımı
- Turbo STT + Piper TTS: ~1GB
- Large-v3 STT + Kokoro TTS: ~2.8GB
- Minimum önerilen RAM: 4GB

### Performans
- Turbo için: CPU öncelikli
- Large-v3 için: GPU kullanımı önerilir (CUDA)
- Piper TTS: Tüm platformlarda hızlı
- Kokoro TTS: GPU ile hız artışı %50

### Ses Kalitesi
- Mikrofon: 16kHz minimum, 48kHz önerilir
- Çevre gürültüsü: STT doğruluğunu etkiler
- Ses tonu: Piper daha nötr, Kokoro daha doğal

## 🚀 Production Checklist

- [ ] Whisper Turbo init'lenmiş
- [ ] Piper TTS init'lenmiş
- [ ] Wake word modeli yüklenmiş
- [ ] IPC bridge test edilmiş
- [ ] Voice state listener'ları çalışıyor
- [ ] Error handling'ler eklenmiş
- [ ] Memory leak check edildi

## 📝 İlgili Dosyalar

```
packages/desktop/src/
├── process/voice/
│   ├── voiceStageHub.ts      # STT/TTS motor yönetimi
│   └── ... (diğer voice bileşenleri)
├── preload/index.ts          # IPC API bridge
└── renderer/
    └── pages/assistant/       # Voice UI bileşenleri
```

## 📚 Kaynaklar

- [Whisper Model](https://github.com/ggerganov/whisper.cpp)
- [Piper TTS](https://github.com/rhassdy/piper)
- [Kokoro TTS](https://github.com/abacate-koko/kokoro)
- [Kitten TTS](https://github.com/keithschott/Kitten-TTS)

## 📝 Lisans

Copyright 2026 The Fool contributors - Apache 2.0
