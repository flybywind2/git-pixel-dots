export function objectParticle(word: string): '을' | '를' {
  const last = word.normalize('NFC').replace(/[\s\p{P}]+$/u, '').at(-1) ?? '';
  const syllable = last.charCodeAt(0);
  if (syllable >= 0xac00 && syllable <= 0xd7a3) {
    return (syllable - 0xac00) % 28 === 0 ? '를' : '을';
  }
  // 영문·숫자 식별자의 끝은 글자 이름으로 읽어요 (R은 ‘알’).
  return /[lmnr013678]/i.test(last) ? '을' : '를';
}
