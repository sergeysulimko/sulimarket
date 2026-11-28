// Raw controls in HTML written as text (Python f-strings of the registry center, HTML templates): one subject, one
// component (5.17). No vendor linter reads HTML inside Python strings - html-validate and HTMLHint lint .html files
// only. Text search, so it errs one way: a <button>
// right after an opening <ed-button> (across quotes, `+` and f-string prefixes) counts as wrapped.
const wrapped = /<ed-button\b[^<>]*>(?:\s|['"+]|\bf(?=['"]))*$/;
// The customizable select draws its own button: `<select><button><selectedcontent>` is the select's part.
const selectPart = /^<button>\s*<selectedcontent\b/;
// A button with a language class is another language control (ed-table-control, ed-table-sort, ed-tab).
const languageControl = /^<button\b[^>]*\bclass=\\?["'][^"'>]*\bed-[a-z]/;

export function markupFindings(source) {
  const findings = [];
  for (const match of source.matchAll(/<button\b/g)) {
    const before = source.slice(Math.max(0, match.index - 300), match.index);
    const tag = source.slice(match.index, match.index + 400);
    if (wrapped.test(before) || selectPart.test(tag) || languageControl.test(tag)) continue;
    findings.push({
      line: source.slice(0, match.index).split('\n').length,
      rule: 'energy-dots/no-raw-button',
      message: 'Energy + dots 5.17: wrap the button in <ed-button> (energy-dots/no-raw-button)',
    });
  }
  return findings;
}
