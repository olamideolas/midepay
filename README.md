# 💎 MidePay & Liquid Glass v2

> **MidePay** is a modern Nigerian digital wallet concept powered by the high-performance **Liquid Glass v2** engine.

---

## 💧 What is Liquid Glass v2?

Inspired by the original [`dashersw/liquid-glass-js`](https://github.com/dashersw/liquid-glass-js) repository, **Liquid Glass v2** is a ground-up re-engineering designed to eliminate the lag, rendering bottlenecks, and usability limitations of traditional canvas-based glass libraries while delivering Apple-grade optical fluidity.

### Why is Liquid Glass v2 Better?

| Feature | Original `dashersw/liquid-glass-js` | **Liquid Glass v2 (Upgraded)** |
| :--- | :--- | :--- |
| **Performance** | Takes slow snapshots with `html2canvas` (freezes for 500ms–2000ms) | **Hardware-accelerated 60/120 FPS** via native GPU filters & shaders |
| **Real-time DOM** | Static snapshot; scrolls and video underneath stay frozen | **100% Live DOM refraction** — scrolls, videos & animations refract in real-time |
| **Cursor Lighting** | Fixed directional lighting | **Dynamic Specular Tracking** — glares and caustics follow cursor/touch |
| **Tactile Physics** | Static 2D planes | **3D Optical Parallax Tilt** + **Liquid Wave Ripples** on tap |
| **API & Syntax** | Imperative only (`new Container()`, `new Button()`) | **Declarative HTML** (`[data-liquid-glass]`) + **Web Component** (`<liquid-glass>`) |
| **Styling & Themes** | Manual uniform tweaks | **Curated Presets**: `emerald`, `crystal`, `obsidian`, `iridescent` |
| **Payload Size** | Multi-megabyte GIF assets & heavy snapshot buffers | **Ultra-lightweight** (~8KB total CSS + JS) zero external dependencies |

---

## 🚀 Interactive Studio Playground

Experience the real-time glass studio with live sliders for blur, specular intensity, saturation, and themes:

👉 **[Open Liquid Glass Studio Demo](liquid-glass-demo.html)**

---

## 🛠️ Quick Start with Liquid Glass v2

You can drop Liquid Glass v2 into **any** web project in seconds:

### 1. Include the Library
```html
<link rel="stylesheet" href="liquid-glass.css">
<script src="liquid-glass.js" defer></script>
```

### 2. Declarative Usage (Zero JavaScript Required)

#### Glass Card
```html
<div class="liquid-glass" data-liquid-glass="card" data-liquid-theme="emerald">
  <h2>Live Liquid Glass Card</h2>
  <p>Content refracts and reacts dynamically to pointer movement.</p>
</div>
```

#### Liquid Glass Button
```html
<button class="liquid-glass liquid-glass-btn" data-liquid-glass="pill" data-liquid-theme="crystal">
  Tap for Wave Ripple
</button>
```

#### Web Component
```html
<liquid-glass variant="card" theme="obsidian" tilt="true" ripple="true">
  <h3>Obsidian Vault</h3>
</liquid-glass>
```

### 3. Programmatic JavaScript API
```javascript
// Attach to an existing element
LiquidGlass.attach(document.querySelector('.my-card'), {
  variant: 'card',    // 'rounded' | 'circle' | 'pill' | 'card'
  theme: 'emerald',   // 'emerald' | 'crystal' | 'obsidian' | 'iridescent'
  tilt: true,         // Enable 3D gyroscope/cursor parallax tilt
  ripple: true,       // Enable liquid wave ripple on click
  maxTilt: 10         // Maximum tilt angle in degrees
});
```

---

## 🇳🇬 MidePay Application Features

- **Personal & Business Banking**: Instant zero-fee transfers across Nigerian commercial banks.
- **Dynamic Account Generation**: Unique 10-digit Nigerian NUBAN generated per user.
- **Authentic Brand Logos**: Official vector marks for OPay, PalmPay, Kuda, Moniepoint, GTBank, Access, Zenith, UBA, FirstBank, Providus, MTN, Airtel, Glo, 9mobile, IKEDC, EKEDC, AEDC, IBEDC, DStv, GOtv, StarTimes, Showmax.
- **Virtual Cards**: Instant USD & NGN virtual cards for global subscriptions.
- **Airtime & Utility Bills**: Real-time bill payment simulation with automated cashback.
- **Supabase Cloud Sync**: Live wallet balances, profile synchronization, and secure authentication.

---

## 📄 License
MIT © MidePay & contributors. Inspired by [dashersw/liquid-glass-js](https://github.com/dashersw/liquid-glass-js).
