export function executableIndex(words: (string | undefined)[]): number {
  let index = 0;
  while (true) {
    const word = words[index];
    if (typeof word !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) return index;
    index += 1;
  }
}
