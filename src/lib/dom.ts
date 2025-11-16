import type { ElementDescriptor } from './types';

const TEXT_SNIPPET_LIMIT = 200;

export function isRecorderUIElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest('[data-recorder-ui="true"]'));
}

export function isSensitiveElement(element: Element | null): boolean {
  if (!element) return false;

  if (element instanceof HTMLInputElement) {
    const type = element.type?.toLowerCase();
    if (type === 'password') return true;
    const autocomplete = element.autocomplete?.toLowerCase();
    if (autocomplete === 'new-password' || autocomplete === 'current-password') {
      return true;
    }
  }

  if (element.hasAttribute('data-privacy')) {
    const value = element.getAttribute('data-privacy') ?? '';
    if (value.toLowerCase() === 'sensitive') return true;
  }

  return false;
}

export function describeElement(element: Element | null): ElementDescriptor | undefined {
  if (!element) return undefined;
  const tag = element.tagName.toLowerCase();
  const id = element.id || undefined;
  const classes = element.classList ? Array.from(element.classList) : [];

  let textSnippet = '';
  if ('innerText' in element) {
    textSnippet = (element as HTMLElement).innerText.trim().slice(0, TEXT_SNIPPET_LIMIT);
  } else {
    textSnippet = element.textContent?.trim().slice(0, TEXT_SNIPPET_LIMIT) ?? '';
  }

  const selector = buildCssSelector(element);

  return {
    tag,
    id,
    classes,
    textSnippet: textSnippet || undefined,
    selector,
  };
}

export function buildCssSelector(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && path.length < 5) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }

    if (current.classList.length) {
      selector += `.${Array.from(current.classList)
        .slice(0, 3)
        .map((cls) => cls.replace(/\s+/g, '-'))
        .join('.')}`;
    }

    const siblingIndex = getElementIndex(current);
    if (siblingIndex > 1) {
      selector += `:nth-of-type(${siblingIndex})`;
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

function getElementIndex(element: Element): number {
  if (!element.parentElement) return 1;
  const siblings = element.parentElement.children;
  let count = 0;
  for (const sibling of siblings) {
    if ((sibling as Element).tagName === element.tagName) {
      count += 1;
    }
    if (sibling === element) {
      return count;
    }
  }
  return 1;
}

export function getElementValue(element: Element): string | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return element.innerText;
  }

  return null;
}

export function elementMatchesSelectors(element: Element | null, selectors: string[]): boolean {
  if (!element || !selectors.length) return false;
  return selectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch (err) {
      console.warn('[Recorder] Invalid selector in denylist', selector, err);
      return false;
    }
  });
}

export function extractHostname(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.toLowerCase();
  } catch {
    return '';
  }
}

