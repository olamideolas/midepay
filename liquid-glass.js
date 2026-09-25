/**
 * Liquid Glass v2 — Apple-Inspired Glass Effects Engine
 * High-performance, zero-latency dynamic glass with live cursor tracking,
 * 3D optical tilt, tactile liquid ripples, and Web Component support.
 */

(function (global) {
  'use strict';

  class LiquidGlassEngine {
    constructor() {
      this.elements = new Set();
      this.isReducedMotion = false;
      this.checkReducedMotion();
      this.initAutoWatcher();
    }

    checkReducedMotion() {
      if (typeof window !== 'undefined' && window.matchMedia) {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.isReducedMotion = media.matches;
        media.addEventListener('change', (e) => {
          this.isReducedMotion = e.matches;
        });
      }
    }

    /**
     * Attach liquid glass effects to a DOM element
     * @param {HTMLElement} el 
     * @param {Object} options 
     */
    attach(el, options = {}) {
      if (!el || this.elements.has(el)) return el;

      const config = {
        tilt: options.tilt ?? el.dataset.tilt !== 'false',
        ripple: options.ripple ?? el.dataset.ripple !== 'false',
        maxTilt: options.maxTilt ?? 8,
        theme: options.theme || el.dataset.liquidTheme || null,
        variant: options.variant || el.dataset.liquidGlass || 'rounded',
      };

      if (!el.classList.contains('liquid-glass')) {
        el.classList.add('liquid-glass');
      }

      if (config.theme) {
        el.classList.add(`lg-theme-${config.theme}`);
      }

      if (config.variant) {
        el.classList.add(`liquid-glass-${config.variant}`);
      }

      if (config.tilt && !this.isReducedMotion) {
        el.classList.add('tilt-enabled');
      }

      let rafId = null;
      let targetX = 0;
      let targetY = 0;
      let currentX = 0;
      let currentY = 0;

      // Pointer movement for specular sheen and 3D tilt
      const handlePointerMove = (e) => {
        const rect = el.getBoundingClientRect();
        const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : rect.left + rect.width / 2);
        const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : rect.top + rect.height / 2);

        const relX = clientX - rect.left;
        const relY = clientY - rect.top;

        const pctX = Math.max(0, Math.min(100, (relX / rect.width) * 100));
        const pctY = Math.max(0, Math.min(100, (relY / rect.height) * 100));

        el.style.setProperty('--lg-mouse-x', `${pctX.toFixed(1)}%`);
        el.style.setProperty('--lg-mouse-y', `${pctY.toFixed(1)}%`);

        if (config.tilt && !this.isReducedMotion) {
          // Normalize from -1 to 1
          const normX = (relX / rect.width - 0.5) * 2;
          const normY = (relY / rect.height - 0.5) * 2;

          targetX = -normY * config.maxTilt;
          targetY = normX * config.maxTilt;

          if (!rafId) {
            rafId = requestAnimationFrame(updateTilt);
          }
        }
      };

      const updateTilt = () => {
        currentX += (targetX - currentX) * 0.15;
        currentY += (targetY - currentY) * 0.15;

        el.style.transform = `perspective(800px) rotateX(${currentX.toFixed(2)}deg) rotateY(${currentY.toFixed(2)}deg) translateY(-2px)`;

        if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
          rafId = requestAnimationFrame(updateTilt);
        } else {
          rafId = null;
        }
      };

      const handlePointerLeave = () => {
        el.style.removeProperty('--lg-mouse-x');
        el.style.removeProperty('--lg-mouse-y');

        if (config.tilt && !this.isReducedMotion) {
          targetX = 0;
          targetY = 0;
          const resetTilt = () => {
            currentX += (0 - currentX) * 0.2;
            currentY += (0 - currentY) * 0.2;
            if (Math.abs(currentX) > 0.05 || Math.abs(currentY) > 0.05) {
              el.style.transform = `perspective(800px) rotateX(${currentX.toFixed(2)}deg) rotateY(${currentY.toFixed(2)}deg)`;
              requestAnimationFrame(resetTilt);
            } else {
              el.style.transform = '';
            }
          };
          requestAnimationFrame(resetTilt);
        }
      };

      // Click / Touch liquid wave ripple
      const handlePointerDown = (e) => {
        if (!config.ripple || this.isReducedMotion) return;

        const rect = el.getBoundingClientRect();
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
        }, 800);
      };

      el.addEventListener('mousemove', handlePointerMove, { passive: true });
      el.addEventListener('mouseleave', handlePointerLeave, { passive: true });
      el.addEventListener('mousedown', handlePointerDown, { passive: true });
      el.addEventListener('touchstart', handlePointerDown, { passive: true });

      this.elements.add(el);
      return el;
    }

    /**
     * Create a new glass element programmatically
     */
    create(tag = 'div', options = {}) {
      const el = document.createElement(tag);
      return this.attach(el, options);
    }

    /**
     * Automatically scan and attach to matching elements
     */
    initAutoWatcher() {
      const scan = () => {
        const targets = document.querySelectorAll('.liquid-glass, [data-liquid-glass], liquid-glass');
        targets.forEach((el) => this.attach(el));
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scan);
      } else {
        scan();
      }

      // Mutation observer to dynamically hydrate new DOM nodes
      if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === 1) {
                if (
                  node.classList.contains('liquid-glass') ||
                  node.hasAttribute('data-liquid-glass') ||
                  node.tagName.toLowerCase() === 'liquid-glass'
                ) {
                  this.attach(node);
                }
                const nested = node.querySelectorAll?.('.liquid-glass, [data-liquid-glass], liquid-glass');
                nested?.forEach((child) => this.attach(child));
              }
            }
          }
        });

        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
    }
  }

  // Register Web Component <liquid-glass>
  if (typeof customElements !== 'undefined' && !customElements.get('liquid-glass')) {
    class LiquidGlassComponent extends HTMLElement {
      connectedCallback() {
        global.LiquidGlass.attach(this, {
          variant: this.getAttribute('variant') || 'card',
          theme: this.getAttribute('theme') || null,
          tilt: this.getAttribute('tilt') !== 'false',
          ripple: this.getAttribute('ripple') !== 'false',
        });
      }
    }
    customElements.define('liquid-glass', LiquidGlassComponent);
  }

  // Export singleton instance
  global.LiquidGlass = new LiquidGlassEngine();

})(typeof window !== 'undefined' ? window : this);
