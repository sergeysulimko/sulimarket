/* Generated from design-language/tokens.json; DO NOT EDIT. Version 1.42.1. Source SHA256 8f95023870d57a679b8bcccb328ae5da697c0ed5a502d559bf31631a55eedc56. */
{
  const root = document.documentElement;
  const hiddenScrollRing = 'data-scroll-focus-hidden';
  const navigationKeys = new Set([
    'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Escape',
  ]);
  // Editable input types from WICG/focus-visible's focusTriggersKeyboardModality.
  const textInputTypes = new Set([
    'text', 'search', 'url', 'tel', 'email', 'password', 'number',
    'date', 'month', 'week', 'time', 'datetime', 'datetime-local',
  ]);
  let tabNavigation = false;

  function isEditingKey(event, target) {
    const editable = target.isContentEditable || (!target.readOnly && (
      target.tagName === 'TEXTAREA' ||
      (target.tagName === 'INPUT' && textInputTypes.has(target.type))
    ));
    return editable && (event.key.length === 1 || event.isComposing ||
      event.key === 'Dead' || event.key === 'Backspace' || event.key === 'Delete');
  }

  function hideScrollRing(element) {
    if (element?.getAttribute('tabindex') !== '0') return;
    const { overflowX, overflowY } = getComputedStyle(element);
    if (/^(auto|scroll)$/.test(overflowX) || /^(auto|scroll)$/.test(overflowY)) {
      element.setAttribute(hiddenScrollRing, '');
    }
  }

  document.addEventListener('keydown', (event) => {
    // Keep WICG's modifier guard and require navigation, activation, or text input.
    if (event.metaKey || event.altKey || event.ctrlKey) return;
    const focused = document.activeElement;
    const activationKey = event.key === 'Enter' || event.key === ' ';
    if (!navigationKeys.has(event.key) &&
        !(focused?.matches(':focus') && (activationKey || isEditingKey(event, focused)))) return;

    root.dataset.focusInput = 'keyboard';
    tabNavigation = event.key === 'Tab';
    if (tabNavigation) focused?.removeAttribute(hiddenScrollRing);
  }, true);

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Tab') tabNavigation = false;
  }, true);

  document.addEventListener('pointerdown', () => {
    root.dataset.focusInput = 'pointer';
    tabNavigation = false;
    hideScrollRing(document.activeElement);
  }, true);

  // Scroll regions have a stricter rule: their ring requires sequential focus.
  document.addEventListener('focusin', (event) => {
    if (!tabNavigation) hideScrollRing(event.target);
    tabNavigation = false;
  }, true);

  document.addEventListener('focusout', (event) => {
    event.target.removeAttribute(hiddenScrollRing);
  }, true);

  hideScrollRing(document.activeElement);

  if (CSS.supports('appearance: base-select') && CSS.supports('selector(::picker(select))')) {
    function prepareSelect(select) {
      // Preserve the native select button if the document already supplied it.
      if (!select.querySelector(':scope > button:first-child')) {
        const button = document.createElement('button');
        button.append(document.createElement('selectedcontent'));
        select.prepend(button);
      }
      for (const option of select.options) {
        if (!option.hasAttribute('title')) option.title = option.label;
      }
    }

    for (const select of document.querySelectorAll('select.ed-select')) prepareSelect(select);
    document.addEventListener('focusin', ({ target }) => {
      if (target.matches('select.ed-select')) prepareSelect(target);
      if (target.matches('select.ed-select option')) {
        if (!target.hasAttribute('title')) target.title = target.label;
        target.toggleAttribute('data-ed-overflow', target.scrollWidth > target.clientWidth);
      }
    });
  }
}
