import valueParser from 'postcss-value-parser';

export const viewportMessage = '10.18: use svh, dvh or lvh for viewport height.';
export const opacityMessage = '1.19: use a semantic color for the state or opacity 0 or 1 for visibility.';
export const strokeMessage = '5.9: use --icon-stroke, --chart-stroke or the product icon adapter.';

export function hasViewportHeight(value) {
  let found = false;
  valueParser(value).walk(node => {
    if (node.type === 'word' && valueParser.unit(node.value)?.unit?.toLowerCase() === 'vh') found = true;
    if (node.type === 'function' && node.value.toLowerCase() === 'url') return false;
  });
  return found;
}

export function isAllowedOpacity(value) {
  if (typeof value === 'number') return value === 0 || value === 1;
  const nodes = valueParser(value).nodes.filter(node => node.type !== 'space' && node.type !== 'comment');
  if (nodes.length !== 1) return false;
  const [node] = nodes;
  if (node.type === 'function') return node.value.toLowerCase() === 'var' && !node.unclosed;
  if (node.type !== 'word') return false;
  const parsed = valueParser.unit(node.value);
  return parsed && parsed.unit === '' && [0, 1].includes(Number(parsed.number));
}
