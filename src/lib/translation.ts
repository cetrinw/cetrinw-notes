import { learningCommand } from "./db";

export const starterChinese: Record<string, string> = {
  "Pete: Hi! Are you Anna?": "皮特：你好！你是安娜吗？",
  "Anna: Yes! Hi there! Are you Pete?": "安娜：是的！你好！你是皮特吗？",
  "Pete: I am Pete.": "皮特：我是皮特。",
  "Anna: Nice to meet you.": "安娜：很高兴认识你。",
  "Anna: Let's try that again. I'm Anna. Nice to meet you.":
    "安娜：我们再来一次。我叫安娜，很高兴认识你。",
  'Pete: I\'m Pete. "Anna" Is that A-N-A?':
    "皮特：我是皮特。安娜的名字拼作 A-N-A 吗？",
  "Anna: No. A-N-N-A": "安娜：不是，是 A-N-N-A。",
  'Pete: Well, Anna with two "n\'s" ... Welcome to ... 1400 Irving Street!':
    "皮特：好吧，名字里有两个 n 的安娜……欢迎来到欧文街 1400 号！",
  "Anna: My new apartment! Yes!": "安娜：我的新公寓！是的！",
};

/** Splits text into chunks within the translation API's byte limit; tokens that
 * are longer than the limit on their own are split on UTF-8 boundaries. */
export function splitForTranslation(text: string, maxBytes = 450): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = chunk ? `${chunk} ${word}` : word;
    if (encoder.encode(next).length <= maxBytes) {
      chunk = next;
      continue;
    }
    if (chunk) chunks.push(chunk);
    chunk = "";
    if (encoder.encode(word).length <= maxBytes) {
      chunk = word;
      continue;
    }
    // A single token longer than the limit (URLs, unspaced scripts).
    let piece = "";
    for (const char of word) {
      if (encoder.encode(piece + char).length > maxBytes) {
        chunks.push(piece);
        piece = char;
      } else piece += char;
    }
    chunk = piece;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
export async function translateText(text: string): Promise<string> {
  if (starterChinese[text]) return starterChinese[text];
  const translations: string[] = [];
  for (const part of splitForTranslation(text)) {
    const result = await learningCommand({
      op: "learning_translate",
      text: part,
    });
    translations.push(result.text);
  }
  return translations.join(" ");
}
