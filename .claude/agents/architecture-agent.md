# Architecture Audit Agent

## Görev

Projenin **process-boundary** kurallarını ve **IPC kullanımı**nı denetle.

## Denetim Listesi

- `packages/desktop/src/process/` → DOM API var mı? (console.log, document, window vb.)
- `packages/desktop/src/renderer/` → Node.js API var mı? (fs, path, child_process vb.)
- `packages/desktop/src/preload/` → IPC güvenliği (contextBridge, webRequest filtreleri)
- Dosya import/export ihlalleri (örn: renderer dosyasından fs importu)
- Electron schema.json (renderer ↔ IPC izinleri)

## Çıktı Formatı

```
### Process Boundary Violations
- [Dosya] - İhlal türü + satır numarası

### IPC Security Risks
- [Dosya] - Risk açıklaması

### Recommendations
1. ...
2. ...
```
