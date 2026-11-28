/* Generated from design-language/tokens.json; DO NOT EDIT. Version 1.42.1. Source SHA256 8f95023870d57a679b8bcccb328ae5da697c0ed5a502d559bf31631a55eedc56. */
// <ed-button> - behaviour of the language button (1.26.0, 27.11.2026). The look is button.css and works without
// this script; the element adds only what CSS cannot: a <button> without a type does not submit its form, `busy`
// and `disabled` stop activation (pointer, Enter and Space all arrive as click) and are announced, a link can be
// disabled. Light DOM: the control is the element's own child, written by the page (Python HTML) or a React adapter.
// Usage: <ed-button variant="primary|secondary|ghost|destructive|live" size="toolbar|action|main|icon" busy disabled>
//          <button>Save</button>  or  <a href="/x">Open</a>
//        </ed-button>
const control = (host) => host.querySelector(':scope > :is(button, a)');

// Defined only where there is a DOM: the module is also evaluated by server rendering and Node tests.
const define = () => customElements.define('ed-button', class EdButton extends HTMLElement {
  static observedAttributes = ['busy', 'disabled'];
  // What this element set on the control, so it never clears a state the page wrote itself.
  #disabled = false;
  #ariaDisabled = false;

  connectedCallback() {
    this.addEventListener('click', this.#block, { capture: true });
    this.#sync();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#block, { capture: true });
  }

  attributeChangedCallback() {
    this.#sync();
  }

  #sync() {
    const target = control(this);
    if (!target) return;
    const button = target.localName === 'button';
    const busy = this.hasAttribute('busy');
    const disabled = this.hasAttribute('disabled');
    if (button && !target.hasAttribute('type')) target.type = 'button';
    if (busy) target.setAttribute('aria-busy', 'true');
    else target.removeAttribute('aria-busy');
    if (button && disabled !== this.#disabled) {
      target.disabled = disabled;
      this.#disabled = disabled;
    }
    const ariaDisabled = busy || (disabled && !button);
    if (ariaDisabled) target.setAttribute('aria-disabled', 'true');
    else if (this.#ariaDisabled) target.removeAttribute('aria-disabled');
    this.#ariaDisabled = ariaDisabled;
  }

  #block = (event) => {
    const target = control(this);
    if (!this.hasAttribute('busy') && !this.hasAttribute('disabled') && target?.getAttribute('aria-disabled') !== 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
});

if (globalThis.customElements && !customElements.get('ed-button')) define();
