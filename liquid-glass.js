/**
 * MidePay Liquid Glass v2.5 — Interactive 3D Tilt & Specular Shimmer Engine
 * Hardware-accelerated pointer tracking, spring-interpolated 3D tilt,
 * specular border shimmer coordinates, and tactile wave ripples.
 */

(function (global) {
  'use strict';

  const KNOWN_THEMES = new Set(['emerald', 'teal', 'gold', 'obsidian', 'crystal', 'iridescent']);
  const KNOWN_SHAPES = new Set(['card', 'rounded', 'pill', 'circle']);

  class LiquidGlassEngine {
    constructor() {
      this.elements = new WeakSet();
      this.isReducedMotion = false;
      this.checkReducedMotion();
      this.initAutoWatcher();
    }

    checkReducedMotion() {
      if (typeof window !== 'undefined' && window.matchMedia) {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.isReducedMotion = media.matches;
        const onChange = (e) => {
          this.isReducedMotion = e.matches;
        };
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', onChange);
        }
      }
    }

    /**
     * Attach liquid glass 3D pointer-tracking tilt, specular border shimmer, and ripple
     * @param {HTMLElement} el
     * @param {Object} options
     */
    attach(el, options = {}) {
      if (!el || el.nodeType !== 1 || this.elements.has(el)) return el;

      const attrVal = (el.dataset.liquidGlass || '').trim().toLowerCase();
      const themeAttr = (el.dataset.liquidTheme || '').trim().toLowerCase();

      const resolvedShape = options.variant || (KNOWN_SHAPES.has(attrVal) ? attrVal : null);
      const resolvedTheme = options.theme || themeAttr || (KNOWN_THEMES.has(attrVal) ? attrVal : null);

      // Enable smooth 3D pointer-tracking tilt by default unless explicitly opted out via data-tilt="false"
      // Large ledger containers (>700px tall) use gentler maxTilt to keep dense tables steady
      const defaultTilt = el.dataset.tilt !== 'false';
      const defaultMaxTilt = resolvedShape === 'rounded' || el.tagName === 'BUTTON' ? 3.2 : 2.4;

      const config = {
        tilt: options.tilt ?? defaultTilt,
        ripple: options.ripple ?? (el.dataset.ripple !== 'false'),
        maxTilt: options.maxTilt ?? (Number(el.dataset.maxTilt) || defaultMaxTilt),
        theme: resolvedTheme,
        variant: resolvedShape
      };

      if (!el.classList.contains('liquid-glass')) {
        el.classList.add('liquid-glass');
      }

      if (config.theme && KNOWN_THEMES.has(config.theme)) {
        el.classList.add(`lg-theme-${config.theme}`);
      }

      if (config.variant && KNOWN_SHAPES.has(config.variant)) {
        el.classList.add(`liquid-glass-${config.variant}`);
      }

      if (config.tilt && !this.isReducedMotion) {
        el.classList.add('tilt-active');
      }

      let rafId = null;
      let targetX = 0;
      let targetY = 0;
      let currentX = 0;
      let currentY = 0;
      let isHovering = false;

      const updateTilt = () => {
        currentX += (targetX - currentX) * 0.14;
        currentY += (targetY - currentY) * 0.14;

        if (!isHovering && Math.abs(currentX) <= 0.04 && Math.abs(currentY) <= 0.04) {
          currentX = 0;
          currentY = 0;
          el.style.transform = '';
          rafId = null;
          return;
        }

        el.style.transform = `perspective(1000px) rotateX(${currentX.toFixed(2)}deg) rotateY(${currentY.toFixed(2)}deg)`;

        if (Math.abs(targetX - currentX) > 0.04 || Math.abs(targetY - currentY) > 0.04) {
          rafId = requestAnimationFrame(updateTilt);
        } else {
          rafId = null;
        }
      };

      const handlePointerMove = (e) => {
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : rect.left + rect.width / 2);
        const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : rect.top + rect.height / 2);

        const relX = clientX - rect.left;
        const relY = clientY - rect.top;

        const pctX = Math.max(0, Math.min(100, (relX / rect.width) * 100));
        const pctY = Math.max(0, Math.min(100, (relY / rect.height) * 100));

        el.style.setProperty('--lg-mouse-x', `${pctX.toFixed(1)}%`);
        el.style.setProperty('--lg-mouse-y', `${pctY.toFixed(1)}%`);

        if (config.tilt && !this.isReducedMotion) {
          isHovering = true;
          // Attenuate tilt automatically on very tall containers so tables remain comfortable
          const heightScale = rect.height > 480 ? 0.45 : 1;
          const normX = (relX / rect.width - 0.5) * 2;
          const normY = (relY / rect.height - 0.5) * 2;

          targetX = -normY * config.maxTilt * heightScale;
          targetY = normX * config.maxTilt * heightScale;

          if (!rafId) {
            rafId = requestAnimationFrame(updateTilt);
          }
        }
      };

      const handlePointerLeave = () => {
        isHovering = false;
        el.style.removeProperty('--lg-mouse-x');
        el.style.removeProperty('--lg-mouse-y');

        if (config.tilt && !this.isReducedMotion) {
          targetX = 0;
          targetY = 0;
          if (!rafId) {
            rafId = requestAnimationFrame(updateTilt);
          }
        }
      };

      const handlePointerDown = (e) => {
        if (!config.ripple || this.isReducedMotion) return;

        if (
          e.target !== el &&
          (e.target.closest('button') ||
            e.target.closest('input') ||
            e.target.closest('select') ||
            e.target.closest('a'))
        ) {
          if (el.tagName.toLowerCase() !== 'button') {
            return;
          }
        }

        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : rect.left + rect.width / 2);
        const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : rect.top + rect.height / 2);

        const ripple = document.createElement('span');
        ripple.className = 'liquid-ripple';
        ripple.style.left = `${clientX - rect.left}px`;
        ripple.style.top = `${clientY - rect.top}px`;

        el.appendChild(ripple);

        setTimeout(() => {
          if (ripple.parentNode === el) {
            el.removeChild(ripple);
          }
        }, 700);
      };

      el.addEventListener('mousemove', handlePointerMove, { passive: true });
      el.addEventListener('mouseleave', handlePointerLeave, { passive: true });
      el.addEventListener('mousedown', handlePointerDown, { passive: true });
      el.addEventListener('touchstart', handlePointerDown, { passive: true });

      this.elements.add(el);
      return el;
    }

    initAutoWatcher() {
      const scan = () => {
        if (typeof document === 'undefined') return;
        const targets = document.querySelectorAll('.liquid-glass, [data-liquid-glass], liquid-glass');
        targets.forEach((el) => this.attach(el));
      };

      if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scan);
        } else {
          scan();
        }

        if (typeof MutationObserver !== 'undefined') {
          const startObserving = () => {
            const rootNode = document.body || document.documentElement;
            if (!rootNode) return;
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                  if (node.nodeType === 1) {
                    if (
                      node.classList?.contains('liquid-glass') ||
                      node.hasAttribute?.('data-liquid-glass') ||
                      node.tagName?.toLowerCase() === 'liquid-glass'
                    ) {
                      this.attach(node);
                    }
                    const nested = node.querySelectorAll?.('.liquid-glass, [data-liquid-glass], liquid-glass');
                    nested?.forEach((child) => this.attach(child));
                  }
                }
              }
            });
            observer.observe(rootNode, { childList: true, subtree: true });
          };

          if (document.body) {
            startObserving();
          } else {
            document.addEventListener('DOMContentLoaded', startObserving, { once: true });
          }
        }
      }
    }
  }

  if (typeof customElements !== 'undefined' && !customElements.get('liquid-glass')) {
    class LiquidGlassComponent extends HTMLElement {
      connectedCallback() {
        global.LiquidGlass.attach(this, {
          variant: this.getAttribute('variant') || 'card',
          theme: this.getAttribute('theme') || null,
          tilt: this.getAttribute('tilt') !== 'false',
          ripple: this.getAttribute('ripple') !== 'false'
        });
      }
    }
    customElements.define('liquid-glass', LiquidGlassComponent);
  }

  global.LiquidGlass = new LiquidGlassEngine();
})(typeof window !== 'undefined' ? window : this);
