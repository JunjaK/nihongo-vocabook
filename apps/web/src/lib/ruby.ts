export type RubySegment =
  | { type: 'ruby'; base: string; annotation: string }
  | { type: 'text'; text: string };

const KANJI_REGEX = /[\u4e00-\u9faf\u3400-\u4dbf]/;
const KANJI_GROUP_REGEX = /([\u4e00-\u9faf\u3400-\u4dbf]+|[^\u4e00-\u9faf\u3400-\u4dbf]+)/g;

function isKanji(char: string): boolean {
  return KANJI_REGEX.test(char);
}

/**
 * Parse a Japanese term and its reading into ruby segments.
 *
 * Example: parseRuby('食べる', 'たべる')
 * → [{ type: 'ruby', base: '食', annotation: 'た' }, { type: 'text', text: 'べる' }]
 */
export function parseRuby(term: string, reading: string): RubySegment[] {
  if (!reading || !term) {
    return [{ type: 'text', text: term || '' }];
  }

  // If term equals reading (pure kana), no ruby needed
  if (term === reading) {
    return [{ type: 'text', text: term }];
  }

  // If term has no kanji, no ruby needed
  if (!KANJI_REGEX.test(term)) {
    return [{ type: 'text', text: term }];
  }

  // Split term into groups of kanji and non-kanji
  const groups = term.match(KANJI_GROUP_REGEX);
  if (!groups) {
    return [{ type: 'text', text: term }];
  }

  // If entire term is kanji, return as single ruby
  if (groups.length === 1 && isKanji(groups[0][0])) {
    return [{ type: 'ruby', base: term, annotation: reading }];
  }

  // Match non-kanji groups from both ends to extract readings for kanji groups
  const segments: RubySegment[] = [];
  let remainingReading = reading;

  // Forward pass: match leading non-kanji groups
  let forwardIndex = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (isKanji(group[0])) break;

    if (remainingReading.startsWith(group)) {
      segments.push({ type: 'text', text: group });
      remainingReading = remainingReading.slice(group.length);
      forwardIndex = i + 1;
    } else {
      // Mismatch — fallback to whole-term ruby
      return [{ type: 'ruby', base: term, annotation: reading }];
    }
  }

  // Backward pass: match trailing non-kanji groups
  const backSegments: RubySegment[] = [];
  let backwardIndex = groups.length - 1;
  for (let i = groups.length - 1; i >= forwardIndex; i--) {
    const group = groups[i];
    if (isKanji(group[0])) break;

    if (remainingReading.endsWith(group)) {
      backSegments.unshift({ type: 'text', text: group });
      remainingReading = remainingReading.slice(0, -group.length);
      backwardIndex = i - 1;
    } else {
      // Mismatch — fallback to whole-term ruby
      return [{ type: 'ruby', base: term, annotation: reading }];
    }
  }

  // Process middle groups (kanji and non-kanji interleaved)
  const middleGroups = groups.slice(forwardIndex, backwardIndex + 1);

  if (middleGroups.length === 0) {
    // Edge case: no middle groups but remaining reading
    if (remainingReading) {
      return [{ type: 'ruby', base: term, annotation: reading }];
    }
    return [...segments, ...backSegments];
  }

  if (middleGroups.length === 1) {
    // Single kanji group — assign all remaining reading
    segments.push({ type: 'ruby', base: middleGroups[0], annotation: remainingReading });
    return [...segments, ...backSegments];
  }

  // Multiple middle groups — try to split reading by non-kanji anchors
  const middleSegments = splitMiddleGroups(middleGroups, remainingReading);
  if (!middleSegments) {
    // Can't reliably split — fallback to whole-term ruby
    return [{ type: 'ruby', base: term, annotation: reading }];
  }

  return [...segments, ...middleSegments, ...backSegments];
}

function splitMiddleGroups(groups: string[], reading: string): RubySegment[] | null {
  // Build a regex pattern from the groups:
  // kanji groups become (.+), non-kanji groups become literal matches
  let pattern = '^';
  const kanjiIndices: number[] = [];

  for (let i = 0; i < groups.length; i++) {
    if (isKanji(groups[i][0])) {
      pattern += '(.+?)';
      kanjiIndices.push(i);
    } else {
      pattern += escapeRegex(groups[i]);
    }
  }
  // Make the last kanji group greedy
  if (kanjiIndices.length > 0) {
    const lastKanjiPos = pattern.lastIndexOf('(.+?)');
    if (lastKanjiPos !== -1) {
      pattern = pattern.substring(0, lastKanjiPos) + '(.+)' + pattern.substring(lastKanjiPos + 5);
    }
  }
  pattern += '$';

  const regex = new RegExp(pattern);
  const match = reading.match(regex);
  if (!match) return null;

  const segments: RubySegment[] = [];
  let matchIndex = 1;

  for (let i = 0; i < groups.length; i++) {
    if (isKanji(groups[i][0])) {
      const annotation = match[matchIndex++];
      if (!annotation) return null;
      segments.push({ type: 'ruby', base: groups[i], annotation });
    } else {
      segments.push({ type: 'text', text: groups[i] });
    }
  }

  return segments;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
