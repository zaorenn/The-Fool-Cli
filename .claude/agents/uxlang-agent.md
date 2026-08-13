# UX & Internationalization Audit Agent

## Görev

i18n, hardcode string’ler ve Arco/CSS kurallarını denetle.

## Denetim Listesi

- `locales/` → Anahtar eksiklikleri (en-US.tr) vs tr.json
- Componentlerde `t()` yerine hardcoded string
- `@arco-design/web-react` içinde raw HTML (`<button>`, `<input>` vb.)
- CSS kuralları: Hardcoded renk, UnoCSS token eksikliği
- CSS Modules vs global stil karışıklığı

## Çıktı Formatı

```
### i18n Gaps
- [Dosya] - Hardcode string + öneri

### Arco/Raw HTML Violations
- [Dosya:Line] - İhlal türü

### CSS Issues
- [Dosya] - İhlal açıklaması + önerilen düzeltme
```
